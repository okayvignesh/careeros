// Slack Events API guts: HMAC signature verify + event_id dedupe.
//
// E.2 acceptance:
//   - `x-slack-signature` verified via `crypto.timingSafeEqual` (constant-time).
//   - `x-slack-request-timestamp` outside +/- 5 min is a replay -> reject.
//   - Missing header -> reject.
//   - Same `event_id` seen twice -> second is a no-op (Redis TTL 24h).
//
// ponytail: no @slack/bolt runtime. Hand-verify because Bolt ships its own HTTP
// server (would collide with Nest) and the signing math is 20 lines.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

/**
 * Result of a signature check. `ok` is the only field the controller reads;
 * `reason` is written to audit_log so a rejection is diagnosable without
 * enabling debug logs.
 */
export interface SlackVerifyResult {
  ok: boolean;
  reason?:
    | 'missing_signature'
    | 'missing_timestamp'
    | 'malformed_timestamp'
    | 'stale_timestamp'
    | 'bad_signature'
    | 'missing_signing_secret';
}

// Slack signs with `v0:<ts>:<raw body>` under HMAC-SHA256, prefixed `v0=`.
// The ceiling on replay-protection is 5 minutes per Slack's own guidance.
const MAX_SKEW_SECONDS = 60 * 5;
const DEDUPE_TTL_SECONDS = 60 * 60 * 24; // 24h per plan/phase-5.

@Injectable()
export class SlackService implements OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err) => this.logger.warn(`redis error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }

  /**
   * Verify a Slack request. `rawBody` MUST be the exact bytes Slack sent -
   * JSON.stringify'ing a parsed body will re-order keys and break the HMAC.
   * The controller wires an express `raw` body-parser scoped to /webhooks/slack
   * to guarantee this.
   */
  verify(
    rawBody: string,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
    now: number = Date.now(),
  ): SlackVerifyResult {
    const secret = process.env.SLACK_SIGNING_SECRET;
    if (!secret) return { ok: false, reason: 'missing_signing_secret' };
    if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
    if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed_timestamp' };

    // Replay window. `now` is injectable so tests are deterministic.
    const skew = Math.abs(now / 1000 - ts);
    if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale_timestamp' };

    const base = `v0:${timestampHeader}:${rawBody}`;
    const expected = 'v0=' + createHmac('sha256', secret).update(base).digest('hex');

    // timingSafeEqual requires equal-length buffers. Guard first so a
    // truncated attacker header can't throw.
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

    return { ok: true };
  }

  /**
   * Register an event_id as seen. Returns true if this is the first sighting,
   * false if the caller should no-op (dedupe hit).
   *
   * ponytail: Redis `SET NX EX`. Atomic, no LUA, no race. If Redis is down we
   * fail-open (log + treat as first sighting) so a Redis outage doesn't drop
   * legitimate events on the floor.
   */
  async markEvent(eventId: string): Promise<boolean> {
    const key = `slack:event:${eventId}`;
    try {
      const set = await this.redis.set(key, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
      return set === 'OK';
    } catch (err) {
      this.logger.warn(`dedupe fail-open (${(err as Error).message})`);
      return true;
    }
  }
}
