// E.4: Gmail integration backend.
//
// Flow:
//   1. `startOAuth(userId)` returns the Google consent URL. User is redirected
//      to Google, comes back to `finishOAuth(code)` which exchanges the code
//      for a refresh_token, stores it encrypted (existing EncryptedSecret
//      pattern - Wave A A-H4), then calls `startWatch(userId)` which registers
//      a Gmail push against our Pub/Sub topic + persists the initial historyId.
//
//   2. Google Pub/Sub calls `POST /webhooks/gmail/push`. The controller
//      verifies the JWT, decodes `message.data` (base64 JSON), and hands the
//      payload to `handlePubSubPush`. We look up the user by email, call
//      `history.list` since the last historyId, dedupe new messageIds via
//      `gmail_processed_messages`, and enqueue each survivor onto the
//      `email-processing` queue for Wave E.6 parsers to consume.
//
//   3. Gmail watches auto-expire after 7 days. `refreshAllWatches` runs
//      daily (see apps/worker/src/gmail-watch-renewal.worker.ts) and re-arms
//      any watch that's within `RENEWAL_WINDOW_MS` of expiry.
//
// Storage:
//   * refresh_token   -> encrypted_secrets, purpose = "integration:gmail:oauth"
//   * historyId + exp -> gmail_watches (one row per user)
//   * seen messageIds -> gmail_processed_messages (unique on userId+messageId)
//
// Ponytail:
//   * googleapis handles OAuth token exchange + Gmail REST. We do not
//     hand-roll either.
//   * google-auth-library handles Pub/Sub JWT verification (gmail.jwt-verify.ts).
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, type ConnectionOptions } from 'bullmq';
import { google } from 'googleapis';
import { encrypt } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPubSubJwt, PubSubJwtError } from './gmail.jwt-verify';
import {
  GmailAuthService,
  KEY,
  GMAIL_TOKEN_PURPOSE as PURPOSE,
  readGmailEnv,
  requireGmailEnv,
  type GmailEnv,
} from './gmail.auth';
import { GmailOutboundService } from './gmail.outbound.service';

// Kept so existing importers (email-ingest) keep resolving from this module.
export { readGmailEnv };
export type { GmailEnv };

// One shared queue instance for the api process. Wave E.6 owns the worker
// side of this queue; keeping the name in one place so E.6 can import it.
export const QUEUE_EMAIL_PROCESSING = 'email-processing';

// Renewal window: any watch expiring within 24h gets re-armed. Gmail watches
// live 7 days; running the cron daily with a 24h window guarantees at-least-
// one renewal attempt before expiry.
const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Pub/Sub push envelope (Google spec). `message.data` is base64 JSON that
 * decodes to `{ emailAddress, historyId }` for Gmail notifications.
 */
export interface PubSubEnvelope {
  message: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

export function decodePubSubMessage(env: PubSubEnvelope): GmailNotification {
  const raw = env.message?.data;
  if (!raw) throw new BadRequestException('pubsub message.data missing');
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(decoded) as Partial<GmailNotification>;
  if (!parsed.emailAddress || !parsed.historyId) {
    throw new BadRequestException('pubsub payload missing emailAddress or historyId');
  }
  return { emailAddress: parsed.emailAddress, historyId: String(parsed.historyId) };
}

/**
 * Pure helper: given a Gmail `history.list` response and a set of already-
 * processed messageIds, return the new messages that need parsing. Exported
 * for tests.
 *
 * The Gmail history shape is nested - a `history` array where each entry may
 * carry `messagesAdded`, `messages` (backfill), etc. We only enqueue on
 * `messagesAdded` because that's the "new mail" signal; labelAdded/Removed
 * live on other keys we ignore.
 */
export interface HistoryListResponse {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{
      message?: { id?: string; threadId?: string; internalDate?: string };
    }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

export interface ExtractedMessage {
  messageId: string;
  threadId: string | null;
  internalDate: number | null;
}

export function extractNewMessages(
  resp: HistoryListResponse,
  alreadySeen: ReadonlySet<string>,
): ExtractedMessage[] {
  const seen = new Set(alreadySeen);
  const out: ExtractedMessage[] = [];
  for (const h of resp.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      const id = m.message?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        messageId: id,
        threadId: m.message?.threadId ?? null,
        internalDate: m.message?.internalDate ? Number(m.message.internalDate) : null,
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly queue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GmailAuthService,
    private readonly outbound: GmailOutboundService,
  ) {
    const connection: ConnectionOptions = {
      url: process.env.REDIS_URL ?? 'redis://redis:6379',
    };
    this.queue = new Queue(QUEUE_EMAIL_PROCESSING, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }

  /** Build the Google OAuth consent URL. */
  startOAuth(userId: string): { url: string } {
    const env = requireGmailEnv();
    return { url: this.auth.consentUrl(env, userId) };
  }

  /**
   * Exchange the OAuth `code` for tokens, persist the refresh_token encrypted,
   * and register the Gmail watch. `state` should equal the signed-in userId
   * that started the flow.
   */
  async finishOAuth(userId: string, code: string): Promise<{ historyId: string; expiration: Date }> {
    const env = requireGmailEnv();
    const client = this.auth.clientForEnv(env);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google did not return a refresh_token. Revoke the previous grant at myaccount.google.com and try again.',
      );
    }
    const ciphertext = encrypt(tokens.refresh_token, KEY, PURPOSE);
    const secret = await this.prisma.encryptedSecret.upsert({
      where: {
        ownerType_ownerId_purpose: { ownerType: 'user', ownerId: userId, purpose: PURPOSE },
      },
      create: { ownerType: 'user', ownerId: userId, purpose: PURPOSE, ciphertext },
      update: { ciphertext },
    });
    await this.prisma.integration.upsert({
      where: { userId_kind: { userId, kind: 'gmail' } },
      create: {
        userId,
        kind: 'gmail',
        status: 'connected',
        tokenSecretId: secret.id,
        metadata: {} as Prisma.InputJsonValue,
      },
      update: {
        status: 'connected',
        tokenSecretId: secret.id,
      },
    });
    await this.recordAudit(userId, 'gmail.oauth.completed', {});
    return this.startWatch(userId);
  }

  /**
   * Register a Gmail push watch against the configured Pub/Sub topic and
   * persist the resulting historyId + expiration.
   */
  async startWatch(userId: string): Promise<{ historyId: string; expiration: Date }> {
    const env = requireGmailEnv();
    const client = await this.auth.userClient(userId, env);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const res = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: env.topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include',
      },
    });
    const historyId = String(res.data.historyId ?? '');
    const expirationMs = res.data.expiration ? Number(res.data.expiration) : Date.now() + 7 * 86_400_000;
    if (!historyId) throw new BadRequestException('gmail watch returned no historyId');
    const expiration = new Date(expirationMs);
    const existing = await this.prisma.gmailWatch.findUnique({ where: { userId } });
    if (existing) {
      await this.prisma.gmailWatch.update({
        where: { userId },
        data: {
          historyId,
          expiration,
          topicName: env.topicName,
          renewedAt: new Date(),
        },
      });
      await this.recordAudit(userId, 'gmail.watch.renewed', { historyId, expiration });
    } else {
      await this.prisma.gmailWatch.create({
        data: {
          userId,
          historyId,
          expiration,
          topicName: env.topicName,
        },
      });
      await this.recordAudit(userId, 'gmail.watch.started', { historyId, expiration });
    }
    return { historyId, expiration };
  }

  /**
   * Verify the Pub/Sub JWT, decode the envelope, diff `history.list` since
   * the last known historyId, dedupe by messageId, and enqueue each new
   * message onto `email-processing` for Wave E.6. Idempotent on retries.
   */
  async handlePubSubPush(
    authorizationHeader: string | undefined,
    envelope: PubSubEnvelope,
  ): Promise<{ processed: number; skipped: number }> {
    const env = requireGmailEnv();
    try {
      await verifyPubSubJwt(authorizationHeader, env.pushAudience);
    } catch (err) {
      const reason = err instanceof PubSubJwtError ? err.reason : 'unknown';
      await this.recordAudit(null, 'gmail.pubsub.rejected', { reason });
      throw new BadRequestException(`pubsub jwt rejected: ${reason}`);
    }

    const notif = decodePubSubMessage(envelope);
    const user = await this.prisma.user.findUnique({
      where: { email: notif.emailAddress },
      select: { id: true },
    });
    if (!user) {
      // Push for an email we don't know - ACK with 2xx (BadRequest is 4xx =
      // Pub/Sub retries; we want it to stop). Return no-op counts and let
      // controller send 204.
      this.logger.warn(`gmail pubsub for unknown email ${notif.emailAddress}`);
      return { processed: 0, skipped: 0 };
    }

    const watch = await this.prisma.gmailWatch.findUnique({ where: { userId: user.id } });
    if (!watch) {
      this.logger.warn(`gmail pubsub for user ${user.id} without a watch row`);
      return { processed: 0, skipped: 0 };
    }

    const client = await this.auth.userClient(user.id, env);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const resp = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: watch.historyId,
      historyTypes: ['messageAdded'],
    });

    const alreadySeen = await this.loadSeenMessageIds(user.id);
    const news = extractNewMessages(resp.data as HistoryListResponse, alreadySeen);

    let processed = 0;
    let skipped = 0;
    for (const m of news) {
      try {
        await this.prisma.gmailProcessedMessage.create({
          data: {
            userId: user.id,
            messageId: m.messageId,
            threadId: m.threadId,
            receivedAt: m.internalDate ? new Date(m.internalDate) : new Date(),
          },
        });
        // F.5 reply linking: if this message belongs to a Gmail thread we
        // opened for an outreach message, record the reply on that row.
        if (m.threadId) {
          await this.linkOutreachReply(user.id, m.threadId, m.messageId);
        }
        await this.queue.add(
          'parse',
          { userId: user.id, messageId: m.messageId, threadId: m.threadId },
          { jobId: `gmail-${user.id}-${m.messageId}` },
        );
        await this.recordAudit(user.id, 'gmail.message.processed', {
          messageId: m.messageId,
          threadId: m.threadId,
        });
        processed++;
      } catch (err) {
        // P2002 = unique violation on (userId, messageId). Second push for
        // the same message; idempotent no-op. Anything else re-throws so
        // Pub/Sub retries.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped++;
          continue;
        }
        throw err;
      }
    }

    // Advance historyId so the next push starts from here even if it lands
    // out of order (Gmail's historyId is monotonic).
    const nextId = String(notif.historyId);
    if (nextId && nextId !== watch.historyId) {
      await this.prisma.gmailWatch.update({
        where: { userId: user.id },
        data: { historyId: nextId },
      });
    }

    return { processed, skipped };
  }

  /**
   * Called daily by the watch-renewal worker. Re-arms any watch within
   * `RENEWAL_WINDOW_MS` of expiry. Returns a summary for logging.
   */
  async refreshAllWatches(now: Date = new Date()): Promise<{
    considered: number;
    renewed: number;
    failed: number;
  }> {
    const cutoff = new Date(now.getTime() + RENEWAL_WINDOW_MS);
    const watches = await this.prisma.gmailWatch.findMany({
      where: { expiration: { lt: cutoff } },
    });
    let renewed = 0;
    let failed = 0;
    for (const w of watches) {
      try {
        await this.startWatch(w.userId);
        renewed++;
      } catch (err) {
        failed++;
        this.logger.error(
          { userId: w.userId, err: (err as Error).message },
          'gmail watch renewal failed',
        );
      }
    }
    return { considered: watches.length, renewed, failed };
  }

  /**
   * Stop the Gmail watch, best-effort revoke the token, delete stored data.
   */
  async disconnect(userId: string): Promise<void> {
    const env = readGmailEnv();
    if (env) {
      try {
        const client = await this.auth.userClient(userId, env);
        const gmail = google.gmail({ version: 'v1', auth: client });
        await gmail.users.stop({ userId: 'me' });
      } catch (err) {
        this.logger.warn(
          { userId, err: (err as Error).message },
          'gmail watch stop failed (best-effort)',
        );
      }
      try {
        const client = await this.auth.userClient(userId, env);
        await client.revokeCredentials();
      } catch (err) {
        this.logger.warn(
          { userId, err: (err as Error).message },
          'gmail token revoke failed (best-effort)',
        );
      }
    }
    await this.prisma.gmailWatch.deleteMany({ where: { userId } });
    await this.prisma.gmailProcessedMessage.deleteMany({ where: { userId } });
    const integration = await this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'gmail' } },
    });
    if (integration?.tokenSecretId) {
      await this.prisma.encryptedSecret
        .delete({ where: { id: integration.tokenSecretId } })
        .catch(() => undefined);
    }
    await this.prisma.integration
      .update({
        where: { userId_kind: { userId, kind: 'gmail' } },
        data: { status: 'revoked', tokenSecretId: null },
      })
      .catch(() => undefined);
  }

  // ---- privates ----------------------------------------------------------

  private async loadSeenMessageIds(userId: string): Promise<Set<string>> {
    // ponytail: 500-row cap. If a single push ever yields more than 500 new
    // messages for a user the dedupe set will miss the tail, but the unique
    // index on (userId, messageId) still enforces idempotency at insert time.
    // Bump the cap or switch to per-id existence check if it ever matters.
    const rows = await this.prisma.gmailProcessedMessage.findMany({
      where: { userId },
      select: { messageId: true },
      orderBy: { processedAt: 'desc' },
      take: 500,
    });
    return new Set(rows.map((r) => r.messageId));
  }

  /**
   * If `threadId` was opened for an outreach message, stamp the first reply
   * onto that row (`replyMessageId`) and audit it. Best-effort: a Redis outage
   * just means no auto-link, never a dropped email.
   */
  private async linkOutreachReply(
    userId: string,
    threadId: string,
    messageId: string,
  ): Promise<void> {
    try {
      const outreachId = await this.outbound.resolveOutreachThread(threadId);
      if (!outreachId) return;
      const updated = await this.prisma.outreachMessage.updateMany({
        where: { id: outreachId, userId, replyMessageId: null },
        data: { replyMessageId: messageId },
      });
      if (updated.count > 0) {
        await this.recordAudit(userId, 'outreach.reply.received', {
          outreachMessageId: outreachId,
          threadId,
          messageId,
        });
      }
    } catch (err) {
      this.logger.warn(`outreach reply link failed: ${(err as Error).message}`);
    }
  }

  private async recordAudit(
    userId: string | null,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: userId ? 'user' : 'system',
          action,
          resourceType: 'integration',
          resourceId: 'gmail',
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch {
      // ponytail: audit write is best-effort; caller error still wins.
    }
  }
}
