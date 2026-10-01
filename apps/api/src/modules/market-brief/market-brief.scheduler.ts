// C-P3 debt: weekly market-brief regeneration cron.
//
// Monday 09:00 UTC (an hour after the C-P3.4d snapshot cron so the fresh
// snapshot is already in the DB when the brief computes its "what changed
// vs last week" diff). Enumerates every user with a UserJobPreferences row
// and calls MarketBriefService.generate(userId); per-user failure is
// isolated so one bad brief never sinks the batch.
//
// Pattern mirrors apps/worker/src/market-snapshot.worker.ts (static jobId
// repeatable job) but lives in-process on the API because the brief needs
// the API-side provider stack (UsageService + SensitivityGateService +
// encrypted-secret decrypt). The worker package can't import those.
//
// ponytail: UTC-weekly, not per-user-timezone. Per-user tz lands if operators
// start caring about "my brief should arrive Monday morning my time" - today
// the brief is a backend artifact the user fetches on load.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketBriefService } from './market-brief.service';

export const QUEUE_MARKET_BRIEF = 'market-brief-weekly';
export const JOB_MARKET_BRIEF = 'market-brief-weekly';
/** Monday 09:00 UTC. Snapshot cron is 06:00 UTC (see market-snapshot.worker.ts);
 *  wait three hours so the fresh snapshot row is in-DB before the diff fetch. */
export const MARKET_BRIEF_CRON = '0 9 * * 1';

export interface WeeklyBriefRunSummary {
  runAt: string;
  users: number;
  briefsGenerated: number;
  errors: number;
}

@Injectable()
export class MarketBriefScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketBriefScheduler.name);
  private readonly queue: Queue;
  private readonly worker: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly briefs: MarketBriefService,
  ) {
    const connection: ConnectionOptions = {
      url: process.env.REDIS_URL ?? 'redis://redis:6379',
    };
    this.queue = new Queue(QUEUE_MARKET_BRIEF, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 30 },
      },
    });
    this.worker = new Worker(
      QUEUE_MARKET_BRIEF,
      async (job: Job) => this.runJob(job.name),
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`market-brief job ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    if (process.env.MARKET_BRIEF_CRON_DISABLE === '1') {
      this.logger.log('market-brief weekly cron disabled via env');
      return;
    }
    // Static jobId → BullMQ dedupes the repeat registration across restarts.
    await this.queue.add(
      JOB_MARKET_BRIEF,
      {},
      {
        jobId: `repeat:${JOB_MARKET_BRIEF}`,
        repeat: { pattern: MARKET_BRIEF_CRON },
      },
    );
    this.logger.log(`market-brief weekly cron scheduled (${MARKET_BRIEF_CRON})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  /**
   * Fire body — one brief per user with saved preferences. One LLM call per
   * user (sequential; concurrency=1 at the Worker above) so we don't blow
   * past the per-user token-cap concurrency in a single tick.
   */
  async runJob(jobName: string): Promise<WeeklyBriefRunSummary> {
    if (jobName !== JOB_MARKET_BRIEF) {
      this.logger.warn(`unknown market-brief job name: ${jobName}`);
      return { runAt: new Date().toISOString(), users: 0, briefsGenerated: 0, errors: 0 };
    }
    const users = await this.prisma.userJobPreferences.findMany({
      select: { userId: true },
    });
    let generated = 0;
    let errors = 0;
    for (const u of users) {
      try {
        await this.briefs.generate(u.userId);
        generated++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `market-brief weekly: generate failed for user=${u.userId}: ${(err as Error).message}`,
        );
      }
    }
    const summary: WeeklyBriefRunSummary = {
      runAt: new Date().toISOString(),
      users: users.length,
      briefsGenerated: generated,
      errors,
    };
    this.logger.log(
      `market-brief weekly run: users=${users.length} generated=${generated} errors=${errors}`,
    );
    return summary;
  }
}
