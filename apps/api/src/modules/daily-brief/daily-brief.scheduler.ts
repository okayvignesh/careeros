import { Injectable, Logger, OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyBriefComposerService, type DailyBriefPayload } from './daily-brief-composer.service';
import {
  DailyBriefPreferencesService,
  nextFiringAt,
} from './daily-brief-preferences.service';
import { DailyBriefDeliveryService } from './daily-brief-delivery.service';

/**
 * E.3 scheduler + worker (one process, one class).
 *
 *   Producer: on module init we enumerate every active preferences row and
 *             enqueue ONE delayed job per user at the next firing instant
 *             for their tz + hour. Also called after any prefs change to
 *             re-key the schedule (delete existing jobId then re-enqueue).
 *
 *   Consumer: BullMQ Worker takes the job, calls the composer, writes the
 *             payload to audit_log (in-app source of truth), fans out via
 *             DailyBriefDeliveryService/ChannelRegistry on the user's
 *             opted-in channels, marks lastSentAt, then re-enqueues the
 *             NEXT day. A transport failure never loses the brief (the
 *             composed row is written first).
 *
 * ponytail: no repeating-scheduler config. Each fire schedules the next
 * one. Trade-off: if the process is down at fire time, that day is
 * skipped (BullMQ eventually processes queued delayed jobs when it wakes,
 * but we skip stale ones based on lastSentAt + a 12h freshness window).
 * Upgrade path: use `Queue.upsertJobScheduler` (BullMQ 5.10+) when we
 * need multi-node HA.
 */

export const QUEUE_DAILY_BRIEF = 'daily-brief';

export interface DailyBriefJobPayload {
  userId: string;
  /** ISO timestamp of when we intended this job to fire (audit + freshness). */
  scheduledFor: string;
}

@Injectable()
export class DailyBriefScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyBriefScheduler.name);
  private readonly queue: Queue<DailyBriefJobPayload>;
  private readonly worker: Worker<DailyBriefJobPayload>;

  constructor(
    private readonly prefs: DailyBriefPreferencesService,
    private readonly composer: DailyBriefComposerService,
    private readonly delivery: DailyBriefDeliveryService,
    private readonly prisma: PrismaService,
  ) {
    const connection: ConnectionOptions = {
      url: process.env.REDIS_URL ?? 'redis://redis:6379',
    };
    this.queue = new Queue<DailyBriefJobPayload>(QUEUE_DAILY_BRIEF, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 100 },
      },
    });
    this.worker = new Worker<DailyBriefJobPayload>(
      QUEUE_DAILY_BRIEF,
      async (job: Job<DailyBriefJobPayload>) => this.runJob(job.data),
      { connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `daily-brief job ${job?.id} for user=${job?.data.userId} failed: ${err.message}`,
      );
    });
  }

  async onModuleInit(): Promise<void> {
    if (process.env.DAILY_BRIEF_DISABLE === '1') {
      this.logger.log('daily-brief scheduler disabled via env');
      return;
    }
    await this.rebuildAll();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  /**
   * Rebuild the schedule for every active preferences row. Called on boot
   * and by the controller after any pref change (upsert/enable/snooze).
   * Idempotent: `jobId` per user, `add()` with a duplicate jobId is a
   * no-op in BullMQ so a race between boot + controller is safe.
   */
  async rebuildAll(): Promise<void> {
    const active = await this.prefs.listActive();
    for (const p of active) {
      await this.reschedule(p.userId, p.timezone, p.sendHourLocal);
    }
    this.logger.log(`daily-brief scheduled for ${active.length} user(s)`);
  }

  async reschedule(userId: string, timezone: string, sendHourLocal: number): Promise<Date> {
    const jobId = `brief-${userId}`;
    // Remove the pending job (if any) so a new tz/hour lands cleanly.
    const existing = await this.queue.getJob(jobId);
    if (existing) await existing.remove();
    const firingAt = nextFiringAt(timezone, sendHourLocal);
    const delay = Math.max(0, firingAt.getTime() - Date.now());
    await this.queue.add(
      'compose-and-send',
      { userId, scheduledFor: firingAt.toISOString() },
      { jobId, delay },
    );
    return firingAt;
  }

  async unschedule(userId: string): Promise<void> {
    const existing = await this.queue.getJob(`brief-${userId}`);
    if (existing) await existing.remove();
  }

  /**
   * Called by the Worker per fired job. Composes, persists as an audit
   * event (single-user MVP; Channel wire deferred), marks lastSentAt,
   * and enqueues the NEXT day's fire.
   */
  async runJob(payload: DailyBriefJobPayload): Promise<{ delivered: boolean; reason?: string }> {
    const p = await this.prefs.get(payload.userId);
    if (!p) return { delivered: false, reason: 'no_prefs' };
    if (!p.isEnabled) return { delivered: false, reason: 'disabled' };
    if (p.snoozedUntil && p.snoozedUntil.getTime() > Date.now()) {
      // Re-schedule for after the snooze ends instead of tomorrow.
      const after = new Date(p.snoozedUntil.getTime() + 60_000);
      const firingAt = nextFiringAt(p.timezone, p.sendHourLocal, after);
      await this.queue.add(
        'compose-and-send',
        { userId: p.userId, scheduledFor: firingAt.toISOString() },
        { jobId: `brief-${p.userId}`, delay: Math.max(0, firingAt.getTime() - Date.now()) },
      );
      return { delivered: false, reason: 'snoozed' };
    }

    const brief = await this.composer.compose(payload.userId);
    // Persist first: the composed row is the in-app source of truth, so a
    // transport failure below can never lose the brief.
    await this.writeAudit(payload.userId, brief, payload.scheduledFor);

    const kinds = this.delivery.kindsFor(p);
    const outcomes = await this.delivery.deliver(payload.userId, brief, kinds);
    const delivered = outcomes.some((o) => o.ok);
    for (const o of outcomes) {
      if (!o.ok) {
        this.logger.warn(`daily-brief ${o.kind} delivery failed: ${o.error ?? 'unknown'}`);
      }
    }
    await this.prefs.markSent(payload.userId);

    // Enqueue the NEXT day's fire before returning so a crash on the
    // await above at least leaves the next day scheduled.
    await this.reschedule(payload.userId, p.timezone, p.sendHourLocal);
    if (delivered) return { delivered: true };
    const reason = outcomes.map((o) => `${o.kind}:${o.error ?? 'failed'}`).join(',');
    return { delivered: false, reason: reason || 'no_channels' };
  }

  private async writeAudit(
    userId: string,
    brief: DailyBriefPayload,
    scheduledFor: string,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action: 'daily_brief.composed',
          resourceType: 'daily_brief',
          resourceId: null,
          payload: {
            scheduledFor,
            xpDelta: brief.xp.deltaLast24h,
            quests: brief.quests.length,
            jobMatches: brief.jobMatches.length,
            streakDays: brief.streak.currentDays,
            // Ponytail: full brief in payload for the /brief/latest endpoint
            // to serve without another compose call. Bounded ~1KB per row.
            brief,
          } as never,
        },
      })
      .catch((err) => {
        this.logger.warn(`daily-brief audit write failed: ${(err as Error).message}`);
      });
  }
}
