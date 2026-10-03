import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ChannelRegistry,
  channelsFor,
  type ChannelKind,
  type SendPayload,
} from '@careeros/messaging';
import { dailyBriefBlock } from '../slack/slack.block-kit';
import type { DailyBriefPayload } from './daily-brief-composer.service';

/**
 * E.3b (Wave E / P5): daily-brief delivery through the messaging
 * ChannelRegistry.
 *
 * The scheduler used to stop at "composed + audited". This service is the
 * seam that actually gets the brief onto a transport:
 *
 *   - `SlackChannel` backed by `SlackService.postMessage` (Block Kit brief).
 *   - `WebChannel` backed by an audit-event writer so the in-app brief
 *     mirror survives even when Slack is down (`/brief/latest` still reads
 *     the composer's `daily_brief.composed` row).
 *
 * Routing is pref-driven: `prefs.channels` are ChannelKinds, and
 * `channelsFor('daily_brief', ...)` is the single ordering contract. The
 * WhatsApp/Discord stubs are deliberately NOT registered, so a user who
 * somehow opted into them gets `channel_not_registered` rather than a thrown
 * NotImplementedError mid-fan-out.
 *
 * Delivery is per-channel best-effort: a Slack outage records an error and
 * lets the web mirror and the next-day reschedule proceed. The brief is never
 * lost - composition is already persisted before delivery runs.
 */

/** DI token for the app-built ChannelRegistry (keeps Nest out of the package). */
export const CHANNEL_REGISTRY = 'DAILY_BRIEF_CHANNEL_REGISTRY';

/** Slack channel-id or user-id the brief posts to. Single-user install pref. */
export const SLACK_BRIEF_CHANNEL_ENV = 'SLACK_BRIEF_CHANNEL';

export interface DeliveryOutcome {
  kind: ChannelKind;
  ok: boolean;
  externalId?: string;
  error?: string;
}

@Injectable()
export class DailyBriefDeliveryService {
  private readonly logger = new Logger(DailyBriefDeliveryService.name);

  constructor(@Inject(CHANNEL_REGISTRY) private readonly registry: ChannelRegistry) {}

  /** The channel kinds the user opted into, in preference order. */
  kindsFor(prefs: { userId: string; channels: readonly string[] }): ChannelKind[] {
    return channelsFor('daily_brief', {
      userId: prefs.userId,
      per_event: { daily_brief: prefs.channels as ChannelKind[] },
    });
  }

  /**
   * Fan the brief out to `kinds`. Never throws: each transport result (or
   * thrown transport error) becomes one `DeliveryOutcome`. Callers decide
   * what a partial failure means (the scheduler reschedules regardless).
   */
  async deliver(
    userId: string,
    brief: DailyBriefPayload,
    kinds: readonly ChannelKind[],
  ): Promise<DeliveryOutcome[]> {
    const message = dailyBriefBlock({
      levelLabel: `Total ${brief.xp.totalXp} XP (+${brief.xp.deltaLast24h} today)`,
      quests: brief.quests.map((q) => ({ id: q.id, title: q.title })),
      newJobs: brief.jobMatches.length,
      marketPulse: brief.marketPulse?.risingSkill ?? 'No signal yet',
      streakDays: brief.streak.currentDays,
    });

    const outcomes: DeliveryOutcome[] = [];
    for (const kind of kinds) {
      const channel = this.registry.get(kind);
      if (!channel) {
        outcomes.push({ kind, ok: false, error: 'channel_not_registered' });
        continue;
      }
      const recipient = this.recipientFor(kind, userId);
      if (!recipient) {
        this.logger.warn(`daily-brief ${kind} skipped: recipient not configured`);
        outcomes.push({ kind, ok: false, error: 'recipient_not_configured' });
        continue;
      }
      const payload: SendPayload = {
        recipient,
        plaintext_fallback: message.text,
        blocks: message.blocks,
      };
      try {
        const res = await channel.send(payload);
        if (res.ok) {
          outcomes.push(
            res.externalId !== undefined
              ? { kind, ok: true, externalId: res.externalId }
              : { kind, ok: true },
          );
        } else {
          outcomes.push(
            res.reason !== undefined ? { kind, ok: false, error: res.reason } : { kind, ok: false },
          );
        }
      } catch (err) {
        this.logger.warn(`daily-brief ${kind} send threw: ${(err as Error).message}`);
        outcomes.push({ kind, ok: false, error: (err as Error).message });
      }
    }
    return outcomes;
  }

  private recipientFor(kind: ChannelKind, userId: string): string | null {
    if (kind === 'web') return userId;
    if (kind === 'slack') return process.env[SLACK_BRIEF_CHANNEL_ENV] ?? null;
    return null;
  }
}
