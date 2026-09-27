// E.4d: daily Gmail watch renewal cron.
//
// Gmail push watches (users.watch) auto-expire 7 days after they're armed.
// This worker runs daily at 03:00 UTC; anything expiring within the next 24h
// is re-armed by calling users.watch again with the same topic. On success
// we update `historyId` + `expiration` + `renewedAt` and drop an audit event.
//
// The apps/api GmailService already owns the OAuth + watch + audit logic
// (apps/api/src/modules/gmail/gmail.service.ts). The worker package can't
// import from apps/api (build boundary), so we inline the minimum needed
// here: read the encrypted refresh_token, build an OAuth client, call
// gmail.users.watch, update the row. The two impls need to stay
// behavior-identical - the assert-parity check is one grep-visible constant
// (`RENEWAL_WINDOW_MS`) shared with gmail.service via convention.
import { google } from 'googleapis';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { decrypt, loadMasterKey } from '@careeros/secrets';

export const QUEUE_GMAIL_WATCH_RENEWAL = 'gmail-watch-renewal';
export const JOB_GMAIL_WATCH_RENEWAL = 'gmail-watch-renewal';
/** Daily at 03:00 UTC. Off the top of the hour is deliberate - stays clear
 *  of the retention (03:17) + market-snapshot (Mon 06:00) slots. */
export const GMAIL_WATCH_RENEWAL_CRON = '0 3 * * *';

/** Any watch within 24h of expiry gets re-armed. Watches live 7 days so
 *  running daily with a 24h window guarantees at-least-one attempt before
 *  the watch actually dies. */
export const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

const KEY = loadMasterKey();
const PURPOSE = 'integration:gmail:oauth';

// Structural repo shape - tests stub with a plain object; production passes a
// real PrismaClient.
export interface GmailRenewalRepo {
  gmailWatch: {
    findMany: (args: {
      where: { expiration: { lt: Date } };
    }) => Promise<Array<{
      id: string;
      userId: string;
      historyId: string;
      expiration: Date;
      topicName: string;
    }>>;
    update: (args: {
      where: { userId: string };
      data: {
        historyId: string;
        expiration: Date;
        topicName: string;
        renewedAt: Date;
      };
    }) => Promise<unknown>;
  };
  integration: {
    findUnique: (args: {
      where: { userId_kind: { userId: string; kind: string } };
    }) => Promise<{ tokenSecretId: string | null; status: string } | null>;
  };
  encryptedSecret: {
    findUnique: (args: { where: { id: string } }) => Promise<{ ciphertext: string } | null>;
  };
  auditEvent: {
    create: (args: { data: Prisma.AuditEventCreateInput }) => Promise<unknown>;
  };
}

/** Watch-arming call - defaults to the real googleapis client, tests inject
 *  a stub so we don't hit the network. */
export type ArmWatch = (
  refreshToken: string,
  topicName: string,
) => Promise<{ historyId: string; expiration: Date }>;

const defaultArmWatch: ArmWatch = async (refreshToken, topicName) => {
  const clientId = requireEnv('GMAIL_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_OAUTH_CLIENT_SECRET');
  const redirectUri = requireEnv('GMAIL_OAUTH_REDIRECT_URI');
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: client });
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterAction: 'include',
    },
  });
  const historyId = String(res.data.historyId ?? '');
  const expirationMs = res.data.expiration ? Number(res.data.expiration) : Date.now() + 7 * 86_400_000;
  if (!historyId) throw new Error('gmail watch returned no historyId');
  return { historyId, expiration: new Date(expirationMs) };
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

export interface RenewalSummary {
  runAt: string;
  considered: number;
  renewed: number;
  failed: number;
}

/**
 * Body of the daily cron. Finds every watch expiring within RENEWAL_WINDOW_MS,
 * re-arms it, writes the new historyId + expiration + audit event. Never
 * throws - per-user failures are counted and logged so one bad token doesn't
 * take out the whole run.
 */
export async function refreshAllWatches(
  prisma: GmailRenewalRepo,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
  now: Date = new Date(),
  armWatch: ArmWatch = defaultArmWatch,
): Promise<RenewalSummary> {
  const cutoff = new Date(now.getTime() + RENEWAL_WINDOW_MS);
  const watches = await prisma.gmailWatch.findMany({ where: { expiration: { lt: cutoff } } });
  let renewed = 0;
  let failed = 0;
  for (const w of watches) {
    try {
      const integration = await prisma.integration.findUnique({
        where: { userId_kind: { userId: w.userId, kind: 'gmail' } },
      });
      if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
        failed++;
        logger.warn({ userId: w.userId }, 'gmail watch renewal: no active integration');
        continue;
      }
      const secret = await prisma.encryptedSecret.findUnique({
        where: { id: integration.tokenSecretId },
      });
      if (!secret) {
        failed++;
        logger.warn({ userId: w.userId }, 'gmail watch renewal: token secret missing');
        continue;
      }
      const refreshToken = decrypt(secret.ciphertext, KEY, PURPOSE);
      const armed = await armWatch(refreshToken, w.topicName);
      await prisma.gmailWatch.update({
        where: { userId: w.userId },
        data: {
          historyId: armed.historyId,
          expiration: armed.expiration,
          topicName: w.topicName,
          renewedAt: new Date(),
        },
      });
      await prisma.auditEvent
        .create({
          data: {
            userId: w.userId,
            actor: 'system',
            action: 'gmail.watch.renewed',
            resourceType: 'integration',
            resourceId: 'gmail',
            payload: {
              historyId: armed.historyId,
              expiration: armed.expiration.toISOString(),
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      renewed++;
    } catch (err) {
      failed++;
      logger.error(
        { userId: w.userId, err: (err as Error).message },
        'gmail watch renewal failed',
      );
    }
  }
  const summary: RenewalSummary = {
    runAt: now.toISOString(),
    considered: watches.length,
    renewed,
    failed,
  };
  logger.info({ job: JOB_GMAIL_WATCH_RENEWAL, ...summary }, 'gmail watch renewal complete');
  return summary;
}

/** BullMQ handler entrypoint. */
export async function handleGmailWatchRenewal(
  prisma: PrismaClient,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<RenewalSummary> {
  return refreshAllWatches(prisma as unknown as GmailRenewalRepo, logger);
}
