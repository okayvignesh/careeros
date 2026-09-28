// E.6e: Consumer for the `email-processing` BullMQ queue (E.4 producer).
//
// Contract (payload E.4 enqueues on gmail.pubsub push):
//   { userId, messageId, threadId }
//
// Per-job pipeline:
//   1. Fetch the full Gmail message (`format=FULL`) with the user's OAuth
//      client. Extract from / subject / receivedAt / HTML body from the
//      MIME tree.
//   2. `wrapUntrusted(html, 'email')` — Wave A A-H5 gate. `blocked` throws
//      InjectionBlockedError; we audit `security.audit.injection_blocked`
//      and drop the mail silently (never enters the parser).
//   3. `matchSender(from)` — sender allowlist (LinkedIn/Indeed/Naukri).
//      Unknown -> audit `email.ingest.sender_not_allowlisted`, drop.
//   4. `parseEmail(...)` -> EmailJob[]. Insert each as a `jobs_raw` row
//      with source `email:<vendor>`. jobs_raw is append-only per
//      AGENTS.md; the existing normalize/verify slice (jobs.service.sync)
//      picks these up on the next sync run.
//   5. Audit `email.ingest.parsed` with vendor + jobs count.
//
// Every user-facing failure short-circuits with an audit event. The worker
// itself never throws — a thrown job would trigger BullMQ retry which is
// wrong for user-input errors (they'll fail identically on retry).
//
// ponytail: this owns its own googleapis client rather than reaching into
// GmailService, because GmailService keeps userOAuthClient private and Wave
// E.6 rules forbid modifying other modules. Ten duplicated lines beats
// coordinating a signature change across concurrent agents.
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { InjectionBlockedError, wrapUntrusted } from '@careeros/ai';
import { parseEmail, matchSender } from '@careeros/email-parsers';
import type { EmailJob, EmailSource } from '@careeros/email-parsers';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_EMAIL_PROCESSING, readGmailEnv, type GmailEnv } from '../gmail/gmail.service';

const KEY = loadMasterKey();
const GMAIL_PURPOSE = 'integration:gmail:oauth';

/** BullMQ payload E.4 enqueues on each new Gmail message. */
export interface EmailProcessingPayload {
  userId: string;
  messageId: string;
  threadId: string | null;
}

/** Result surfaced to unit tests + the worker log. Not persisted. */
export interface IngestResult {
  status: 'parsed' | 'dropped-injection' | 'dropped-sender' | 'skipped-nohtml' | 'skipped-noconfig';
  source?: EmailSource;
  jobsInserted?: number;
  reason?: string;
}

@Injectable()
export class EmailIngestService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailIngestService.name);
  private readonly worker: Worker<EmailProcessingPayload> | null;

  constructor(private readonly prisma: PrismaService) {
    const env = readGmailEnv();
    if (!env) {
      // Gmail integration not configured (dev laptop without OAuth env). Skip
      // spinning up the worker — the queue name still exists so producers do
      // not fail; consumer just doesn't drain.
      this.logger.warn('gmail env missing; email-ingest worker disabled');
      this.worker = null;
      return;
    }
    const connection: ConnectionOptions = {
      url: process.env.REDIS_URL ?? 'redis://redis:6379',
    };
    this.worker = new Worker<EmailProcessingPayload>(
      QUEUE_EMAIL_PROCESSING,
      async (job: Job<EmailProcessingPayload>) => this.processJob(job.data, env),
      {
        connection,
        // Modest concurrency: Gmail's per-user rate limit is 250 quota
        // units/second and each `messages.get` costs 5. Ten in-flight per
        // user is fine; across all users we'll see far less overlap.
        concurrency: 5,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        { jobId: job?.id, userId: job?.data.userId, err: err.message },
        'email-ingest job failed',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  /**
   * Public for tests. Fetches the message, gates through wrapUntrusted, routes
   * through the sender allowlist, parses, and inserts jobs_raw rows.
   */
  async processJob(payload: EmailProcessingPayload, env: GmailEnv): Promise<IngestResult> {
    const { userId, messageId } = payload;
    let fetched: FetchedMessage;
    try {
      fetched = await this.fetchMessage(userId, messageId, env);
    } catch (err) {
      // Anything from Gmail (token expired, message deleted, network) is a
      // legitimate retry candidate — let BullMQ handle backoff.
      throw err;
    }

    if (!fetched.html) {
      await this.audit(userId, 'email.ingest.skipped_no_html', { messageId });
      return { status: 'skipped-nohtml', reason: 'no html body' };
    }

    // Gate 1 — wrapUntrusted. Any blocked-severity injection payload never
    // reaches the parser. We MUST call this on the raw HTML so the wrap
    // audit hook fires exactly as it does on job descriptions.
    try {
      wrapUntrusted(fetched.html, 'email');
    } catch (err) {
      if (err instanceof InjectionBlockedError) {
        await this.audit(userId, 'security.audit.injection_blocked', {
          messageId,
          source: 'email',
          kinds: err.hits,
        });
        return { status: 'dropped-injection', reason: err.hits.join(',') };
      }
      throw err;
    }

    // Gate 2 — sender allowlist. matchSender handles display-name +
    // angle-brackets and is case-insensitive.
    const source = matchSender(fetched.from);
    if (!source) {
      await this.audit(userId, 'email.ingest.sender_not_allowlisted', {
        messageId,
        from: fetched.from,
      });
      return { status: 'dropped-sender', reason: fetched.from };
    }

    // Parse + persist. parseEmail returns null only on unknown sender (we
    // already gated), so the ! is safe — but narrow anyway.
    const parsed = parseEmail({
      from: fetched.from,
      subject: fetched.subject,
      html: fetched.html,
      receivedAt: fetched.receivedAt,
    });
    if (!parsed) {
      // Defensive: sender changed shape between matchSender + parseEmail.
      await this.audit(userId, 'email.ingest.sender_not_allowlisted', {
        messageId,
        from: fetched.from,
      });
      return { status: 'dropped-sender', reason: 'race' };
    }

    const inserted = await this.insertJobs(source, parsed.jobs);
    await this.audit(userId, 'email.ingest.parsed', {
      messageId,
      source,
      jobsExtracted: parsed.jobs.length,
      jobsInserted: inserted,
    });
    return { status: 'parsed', source, jobsInserted: inserted };
  }

  private async insertJobs(source: EmailSource, jobs: EmailJob[]): Promise<number> {
    if (jobs.length === 0) return 0;
    // jobs_raw is append-only (AGENTS.md). No unique index on (source,
    // sourceId), so re-runs of the same email re-append — that's the
    // intended provenance log. Downstream normalize/verify dedupes by
    // canonicalUrl.
    const rows: Prisma.JobRawCreateManyInput[] = jobs.map((j) => ({
      source: `email:${source}`,
      sourceId: j.url,
      canonicalUrl: j.url,
      payload: {
        title: j.title,
        company: j.company,
        location: j.location,
        snippet: j.snippet,
        postedAt: j.postedAt?.toISOString() ?? null,
      } as Prisma.InputJsonValue,
    }));
    const result = await this.prisma.jobRaw.createMany({ data: rows });
    return result.count;
  }

  // -- Gmail helpers (local — GmailService.userOAuthClient is private) -----

  private async fetchMessage(
    userId: string,
    messageId: string,
    env: GmailEnv,
  ): Promise<FetchedMessage> {
    const client = await this.oauthClient(userId, env);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'FULL',
    });
    const msg = res.data;
    const headers = new Map<string, string>(
      (msg.payload?.headers ?? [])
        .filter((h): h is { name: string; value: string } => !!h.name && h.value != null)
        .map((h) => [h.name.toLowerCase(), h.value]),
    );
    const from = headers.get('from') ?? '';
    const subject = headers.get('subject') ?? '';
    const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
    const html = extractHtmlBody(msg.payload ?? {});
    return { from, subject, receivedAt, html };
  }

  private async oauthClient(userId: string, env: GmailEnv): Promise<OAuth2Client> {
    const integration = await this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'gmail' } },
    });
    if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
      throw new Error('Gmail not connected');
    }
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: integration.tokenSecretId },
    });
    if (!secret) throw new Error('Gmail token secret missing');
    const refreshToken = decrypt(secret.ciphertext, KEY, GMAIL_PURPOSE);
    const client = new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private async audit(
    userId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'system',
          action,
          resourceType: 'email',
          resourceId: String(payload['messageId'] ?? 'unknown'),
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch {
      // audit must never break the pipeline.
    }
  }
}

interface FetchedMessage {
  from: string;
  subject: string;
  receivedAt: Date;
  html: string;
}

/** Gmail MIME payload — subset we care about. */
interface GmailPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
}

/**
 * Walk the MIME tree, prefer `text/html` over `text/plain`. Gmail encodes
 * the body as base64url; convert to utf-8 string. Returns '' when no HTML
 * part exists (caller drops the mail).
 */
export function extractHtmlBody(payload: GmailPart): string {
  const html = findPart(payload, 'text/html');
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  // Some alert mails only have text/plain — fall back so we do not lose the
  // links. The parser can still walk `<a href>` after we wrap the plain
  // text in a minimal <html><body>...</body></html>.
  const plain = findPart(payload, 'text/plain');
  if (plain?.body?.data) {
    const text = decodeBase64Url(plain.body.data);
    return `<html><body><pre>${text}</pre></body></html>`;
  }
  return '';
}

function findPart(part: GmailPart, mime: string): GmailPart | null {
  if (part.mimeType === mime) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return null;
}

function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}
