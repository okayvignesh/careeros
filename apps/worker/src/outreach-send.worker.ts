// F.5 worker: due outreach sends. The API stages an approved Gmail draft and
// enqueues this job with a delay equal to the composer's business-hour slot
// (`sendAt`); this handler flushes the staged draft via `drafts.send`.
//
// Idempotent: the job id is `outreach-send:<outreachMessageId>` (set by the
// producer) and the handler refuses to send when the row is already `sent` or
// has no draft. A re-run after a crash is therefore a no-op, never a double
// send.
//
// The approval gate lives upstream: the API only stages + schedules after the
// user approved the `outreach_email` approval item, so this worker never sends
// anything a human did not approve.
import { google } from 'googleapis';
import type { PrismaClient } from '@prisma/client';
import { retry } from '@careeros/shared';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import type { Logger } from 'pino';

export const QUEUE_OUTREACH_SEND = 'outreach-send';
export const JOB_OUTREACH_SEND = 'send-due';

const KEY = loadMasterKey();
const GMAIL_TOKEN_PURPOSE = 'integration:gmail:oauth';

export interface OutreachSendPayload {
  userId: string;
  outreachMessageId: string;
}

export interface OutreachSendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  gmailMessageId?: string;
}

export async function handleOutreachSend(
  prisma: PrismaClient,
  logger: Logger,
  data: OutreachSendPayload,
): Promise<OutreachSendResult> {
  const row = await prisma.outreachMessage.findFirst({
    where: { id: data.outreachMessageId, userId: data.userId },
    select: { id: true, status: true, gmailDraftId: true, subject: true },
  });
  if (!row) {
    logger.warn({ outreachMessageId: data.outreachMessageId }, 'outreach send: row not found');
    return { ok: false, skipped: true, reason: 'not-found' };
  }
  if (row.status === 'sent') {
    return { ok: true, skipped: true, reason: 'already-sent' };
  }
  if (!row.gmailDraftId) {
    // The draft was never staged (e.g. approval failed). Nothing to send.
    logger.warn({ outreachMessageId: row.id }, 'outreach send: no staged draft');
    return { ok: false, skipped: true, reason: 'no-draft' };
  }

  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Gmail env missing; cannot send outreach');
  }

  const integration = await prisma.integration.findUnique({
    where: { userId_kind: { userId: data.userId, kind: 'gmail' } },
  });
  if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
    throw new Error('Gmail not connected for outreach send');
  }
  const secret = await prisma.encryptedSecret.findUnique({
    where: { id: integration.tokenSecretId },
  });
  if (!secret) throw new Error('Gmail token secret missing');
  const refreshToken = decrypt(secret.ciphertext, KEY, GMAIL_TOKEN_PURPOSE);

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await retry(
    () => gmail.users.drafts.send({ userId: 'me', requestBody: { id: row.gmailDraftId as string } }),
    {
      attempts: 3,
      baseMs: 1_000,
      maxMs: 30_000,
      shouldRetry: (err) => {
        const status =
          (err as { code?: number; response?: { status?: number } })?.response?.status ??
          (err as { code?: number })?.code;
        if (status === 429) return true;
        if (typeof status === 'number' && status >= 500) return true;
        return status == null;
      },
      onRetry: (_err, attempt, delayMs) =>
        logger.warn({ outreachMessageId: row.id, attempt, delayMs }, 'gmail draft send retry'),
    },
  );

  const gmailMessageId = res.data.id ?? '';
  await prisma.outreachMessage.update({
    where: { id: row.id },
    data: { status: 'sent', sentAt: new Date() },
  });
  await prisma.auditEvent
    .create({
      data: {
        userId: data.userId,
        actor: 'system',
        action: 'outreach.sent',
        resourceType: 'outreach_message',
        resourceId: row.id,
        payload: { gmailMessageId, threadId: res.data.threadId ?? null, via: 'worker' },
      },
    })
    .catch(() => undefined);

  logger.info({ outreachMessageId: row.id, gmailMessageId }, 'outreach draft sent');
  return { ok: true, gmailMessageId };
}
