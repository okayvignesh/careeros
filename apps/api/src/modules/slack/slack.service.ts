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
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import { SlackOAuthService } from './slack.oauth';

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
// OAuth CSRF nonce lifetime. The operator must finish the Slack consent screen
// within this window; the nonce is one-time-use regardless.
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

/** Server-side OAuth `state` payload. `userId` binds the nonce to the session
 * that started the install; `expiresAt` is checked explicitly so expiry is
 * deterministic and testable independent of Redis TTL. */
export interface SlackOAuthState {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class SlackService implements OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private readonly redis: Redis;

  constructor(@Optional() private readonly oauth?: SlackOAuthService) {
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

  /**
   * Issue a one-time OAuth `state` nonce bound to `userId`. Stored in Redis
   * (existing transient-state store) under `slack:oauth:state:<nonce>` with a
   * TTL, so an abandoned install self-cleans.
   *
   * Fails CLOSED: unlike event dedupe, a Redis outage must not mint a token the
   * callback can never verify. No nonce => installer sees an error, not a
   * silently unverifiable install.
   */
  async createOAuthState(userId: string, now: number = Date.now()): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const payload: SlackOAuthState = {
      userId,
      expiresAt: now + OAUTH_STATE_TTL_SECONDS * 1000,
    };
    try {
      await this.redis.set(
        `slack:oauth:state:${state}`,
        JSON.stringify(payload),
        'EX',
        OAUTH_STATE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.error(`oauth state store failed: ${(err as Error).message}`);
      throw new Error('could not issue oauth state');
    }
    return state;
  }

  /**
   * Consume an OAuth `state` nonce. `GETDEL` makes it one-time-use (replay of
   * a captured callback fails). Returns true only when the nonce exists, was
   * minted for `userId`, and has not expired. Fails CLOSED on Redis errors.
   */
  async consumeOAuthState(state: string, userId: string, now: number = Date.now()): Promise<boolean> {
    const key = `slack:oauth:state:${state}`;
    let raw: string | null;
    try {
      raw = await this.redis.getdel(key);
    } catch (err) {
      this.logger.warn(`oauth state read failed: ${(err as Error).message}`);
      return false;
    }
    if (!raw) return false;
    let parsed: SlackOAuthState;
    try {
      parsed = JSON.parse(raw) as SlackOAuthState;
    } catch {
      return false;
    }
    if (!parsed || parsed.userId !== userId || typeof parsed.expiresAt !== 'number') return false;
    return parsed.expiresAt > now;
  }

  /**
   * E.3b: outbound `chat.postMessage`. Backs the messaging `SlackChannel`
   * (constructor injection in the daily-brief module) so the Channel package
   * stays free of @slack/web-api. Resolves the bot token from the encrypted
   * store on each call (tokens rotate on reinstall); falls back to the
   * `SLACK_BOT_TOKEN` env for out-of-band installs. Transport failures are
   * returned, never thrown, so a Slack outage cannot abort the fan-out or
   * lose the composed brief.
   *
   * `args.metadata` is accepted for Channel-shape compatibility but not
   * forwarded: Slack rejects message metadata that does not match a
   * registered event schema.
   */
  async postMessage(args: {
    channel: string;
    text: string;
    blocks?: unknown[];
    metadata?: Record<string, unknown>;
    /** Reply in a thread (Events API quick-action replies). */
    thread_ts?: string;
  }): Promise<{ ok: boolean; ts?: string; error?: string }> {
    const stored = this.oauth ? await this.oauth.loadBotToken().catch(() => null) : null;
    const token = stored ?? process.env.SLACK_BOT_TOKEN ?? null;
    if (!token) return { ok: false, error: 'slack_bot_token_missing' };
    try {
      const { WebClient } = await import('@slack/web-api');
      const client = new WebClient(token);
      const res = await client.chat.postMessage({
        channel: args.channel,
        text: args.text,
        ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}),
        // ponytail: the Block Kit builder in this module owns the shape; the
        // WebClient's Block union is structurally compatible, so assert at the
        // boundary rather than re-importing @slack/types.
        ...(args.blocks ? { blocks: args.blocks as never } : {}),
      });
      if (!res.ok) return { ok: false, error: res.error ?? 'slack_post_failed' };
      return res.ts !== undefined ? { ok: true, ts: res.ts } : { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
