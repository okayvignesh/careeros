// F.5: Gmail outbound. Real `drafts.create` / `messages.send` over the user's
// existing OAuth credentials, with MIME built by @careeros/messaging (pure,
// header-injection safe), shared idempotency via Redis, and retry/backoff via
// packages/shared (429 + 5xx retried; 4xx fails fast).
//
// The user's OAuth grant is `gmail.readonly` in the shipped manifest. Drafting
// and sending need `gmail.compose` (drafts.create) / `gmail.send`
// (messages.send). Rather than silently widening every install's scope, the
// first outbound call surfaces Google's 403 scope error to the caller, who
// re-consents with the widened scope. `docs/gmail-setup.md` (owned by E.1
// install docs) is the operator's reference for that.
import { BadRequestException, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import Redis from 'ioredis';
import { retry } from '@careeros/shared';
import {
  buildRfc822Message,
  deterministicMessageId,
  encodeRawMessage,
  type OutboundEmail,
} from '@careeros/messaging';
import { PrismaService } from '../../prisma/prisma.service';
import { GmailAuthService, requireGmailEnv } from './gmail.auth';

const DRAFT_IDEM_TTL_SECONDS = 60 * 60 * 24 * 7;
const THREAD_LINK_TTL_SECONDS = 60 * 60 * 24 * 90;

/** Input for a new Gmail draft. */
export interface CreateDraftInput {
  to: string;
  subject: string;
  body: string;
  /** Existing Gmail thread to attach the draft to (reply threading). */
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  /**
   * Stable caller key. Repeat calls with the same key return the first draft
   * instead of creating a second one (Gmail's drafts.create has no native
   * idempotency key).
   */
  idempotencyKey?: string;
  /** When set, the created thread is remembered for reply-linking. */
  linkOutreachMessageId?: string;
  from?: string;
}

export interface DraftResult {
  draftId: string;
  messageId: string | null;
  threadId: string | null;
}

export interface SendResult {
  messageId: string;
  threadId: string | null;
}

/**
 * Optional context for a send so the audit trail can name the recipient even
 * when the send targets a pre-staged Gmail draft (the draft id alone carries no
 * address). Both fields are best-effort: when the caller does not know them the
 * audit event still records the Gmail message + thread ids.
 */
export interface SendAuditContext {
  recipient?: string;
  outreachMessageId?: string;
}

@Injectable()
export class GmailOutboundService implements OnModuleDestroy {
  private readonly logger = new Logger(GmailOutboundService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GmailAuthService,
  ) {
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

  /** Create a MIME draft. Idempotent when `idempotencyKey` is supplied. */
  async createDraft(userId: string, input: CreateDraftInput): Promise<DraftResult> {
    const idemKey = input.idempotencyKey
      ? `gmail:draft:idem:${userId}:${input.idempotencyKey}`
      : null;
    if (idemKey) {
      const cached = await this.readIdempotent<DraftResult>(idemKey);
      if (cached) return cached;
    }

    const env = requireGmailEnv();
    const client = await this.auth.userClient(userId, env);
    const messageId = input.idempotencyKey
      ? deterministicMessageId(`draft:${userId}:${input.idempotencyKey}`)
      : undefined;

    const rfc: OutboundEmail = {
      to: input.to,
      subject: input.subject,
      body: input.body,
      ...(input.from ? { from: input.from } : {}),
      ...(messageId ? { messageId } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references ? { references: input.references } : {}),
    };
    const raw = encodeRawMessage(buildRfc822Message(rfc));

    const result = await this.withGmailRetry('drafts.create', () =>
      google
        .gmail({ version: 'v1', auth: client })
        .users.drafts.create({
          userId: 'me',
          requestBody: {
            message: {
              raw,
              ...(input.threadId ? { threadId: input.threadId } : {}),
            },
          },
        }),
    );

    const out: DraftResult = {
      draftId: result.data.id ?? '',
      messageId: result.data.message?.id ?? null,
      threadId: result.data.message?.threadId ?? null,
    };
    if (!out.draftId) throw new BadRequestException('Gmail drafts.create returned no id');

    if (input.linkOutreachMessageId && out.threadId) {
      await this.rememberOutreachThread(out.threadId, input.linkOutreachMessageId);
    }
    if (idemKey) await this.writeIdempotent(idemKey, out);
    return out;
  }

  /**
   * Send a previously created draft (the controlled-execution send step).
   * `drafts.send` is idempotent by draft id (Gmail marks the draft sent and a
   * re-send of the same id cannot deliver twice), so retry is always safe here.
   * The audit event is written unconditionally on success — AGENTS.md §3.
   */
  async sendDraft(
    userId: string,
    draftId: string,
    context: SendAuditContext = {},
  ): Promise<SendResult> {
    if (!draftId) throw new BadRequestException('draftId is required');
    const env = requireGmailEnv();
    const client = await this.auth.userClient(userId, env);
    const res = await this.withGmailRetry('drafts.send', () =>
      google
        .gmail({ version: 'v1', auth: client })
        .users.drafts.send({ userId: 'me', requestBody: { id: draftId } }),
    );
    const out: SendResult = {
      messageId: res.data.id ?? '',
      threadId: res.data.threadId ?? null,
    };
    if (!out.messageId) throw new BadRequestException('Gmail drafts.send returned no message id');
    await this.auditSend(userId, {
      messageId: out.messageId,
      threadId: out.threadId,
      draftId,
      ...(context.recipient ? { to: context.recipient } : {}),
      ...(context.outreachMessageId ? { outreachMessageId: context.outreachMessageId } : {}),
    });
    return out;
  }

  /**
   * Direct message send (replies, or a draftless send after approval).
   *
   * This route is deliberately reachable by the authenticated owner without a
   * second approval hop (it is how replies and one-off notes go out), but
   * AGENTS.md §3 is non-negotiable: every outbound send must be traceable, so
   * a `gmail.sent` audit event is written on success. It is NOT exempt from
   * §3 just because it skips the queue.
   *
   * Retry safety: `messages.send` of a raw MIME message has no native
   * idempotency key (unlike `drafts.create`), so an ambiguous failure that we
   * retried could deliver a duplicate. When the caller supplies a stable
   * `idempotencyKey` we derive a deterministic `Message-ID` from it and retry
   * normally; without a key the Message-ID would be regenerated on each attempt
   * and retrying is unsafe, so we attempt exactly once.
   */
  async sendMessage(userId: string, input: CreateDraftInput): Promise<SendResult> {
    const env = requireGmailEnv();
    const client = await this.auth.userClient(userId, env);
    const messageId = input.idempotencyKey
      ? deterministicMessageId(`send:${userId}:${input.idempotencyKey}`)
      : undefined;
    const rfc: OutboundEmail = {
      to: input.to,
      subject: input.subject,
      body: input.body,
      ...(input.from ? { from: input.from } : {}),
      ...(messageId ? { messageId } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references ? { references: input.references } : {}),
    };
    const raw = encodeRawMessage(buildRfc822Message(rfc));
    const res = await this.withGmailRetry(
      'messages.send',
      () =>
        google.gmail({ version: 'v1', auth: client }).users.messages.send({
          userId: 'me',
          requestBody: {
            raw,
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        }),
      // No deterministic Message-ID => no idempotency guard => do not retry.
      messageId ? 3 : 1,
    );
    const out: SendResult = {
      messageId: res.data.id ?? '',
      threadId: res.data.threadId ?? null,
    };
    if (!out.messageId) throw new BadRequestException('Gmail messages.send returned no message id');
    await this.auditSend(userId, {
      messageId: out.messageId,
      threadId: out.threadId,
      to: input.to,
      ...(input.linkOutreachMessageId ? { outreachMessageId: input.linkOutreachMessageId } : {}),
    });
    return out;
  }

  // ---- reply linking -------------------------------------------------------

  async rememberOutreachThread(threadId: string, outreachMessageId: string): Promise<void> {
    try {
      await this.redis.set(
        `gmail:outreach:thread:${threadId}`,
        outreachMessageId,
        'EX',
        THREAD_LINK_TTL_SECONDS,
      );
    } catch (err) {
      // Non-fatal: losing the link only costs reply auto-linking, not the send.
      this.logger.warn(`thread link write failed: ${(err as Error).message}`);
    }
  }

  async resolveOutreachThread(threadId: string): Promise<string | null> {
    try {
      return await this.redis.get(`gmail:outreach:thread:${threadId}`);
    } catch {
      return null;
    }
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Retry only the failure classes AGENTS.md allows: 429 (rate), 5xx, and the
   * Gmail 403 rateLimitExceeded/quotaExceeded variants. 400/401/403-scope fail
   * fast because retrying cannot fix them.
   */
  private async withGmailRetry<T>(op: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
    return retry(fn, {
      attempts,
      baseMs: 500,
      maxMs: 30_000,
      shouldRetry: (err) => {
        const status = errorStatus(err);
        if (status === 429) return true;
        if (status != null && status >= 500) return true;
        if (status === 403 && isRateLimited(err)) return true;
        return status == null; // network / unknown
      },
      onRetry: (_err, attempt, delayMs) => {
        this.logger.warn(`gmail ${op} retry ${attempt} in ${delayMs}ms`);
      },
    });
  }

  private async readIdempotent<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeIdempotent(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', DRAFT_IDEM_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`idempotency store failed: ${(err as Error).message}`);
    }
  }

  /**
   * Record every outbound send (AGENTS.md §3: "nothing sends without approval
   * and nothing is untraceable"). Mirrors `OutreachService.audit`: actor
   * `system`, resourceType `gmail_message`, resourceId = the Gmail message id.
   * Non-fatal on write failure — a transient audit outage must not turn a
   * delivered email into a client error — but it is logged so the gap is
   * visible.
   */
  private async auditSend(
    userId: string,
    event: {
      messageId: string;
      threadId: string | null;
      to?: string;
      draftId?: string;
      outreachMessageId?: string;
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      gmailMessageId: event.messageId,
      threadId: event.threadId,
    };
    if (event.to) payload.recipient = event.to;
    if (event.draftId) payload.gmailDraftId = event.draftId;
    if (event.outreachMessageId) payload.outreachMessageId = event.outreachMessageId;
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'system',
          action: 'gmail.sent',
          resourceType: 'gmail_message',
          resourceId: event.messageId,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`gmail send audit failed: ${(err as Error).message}`);
    }
  }
}

function errorStatus(err: unknown): number | null {
  const e = err as { status?: number; code?: number; response?: { status?: number } };
  const s = e?.status ?? e?.response?.status ?? (typeof e?.code === 'number' ? e.code : undefined);
  return typeof s === 'number' ? s : null;
}

function isRateLimited(err: unknown): boolean {
  const errors = (err as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } })
    ?.response?.data?.error?.errors;
  if (Array.isArray(errors)) {
    return errors.some((e) =>
      ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(e.reason ?? ''),
    );
  }
  const msg = (err as Error)?.message ?? '';
  return /quota|rate limit/i.test(msg);
}
