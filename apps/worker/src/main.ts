/**
 * Worker entrypoint. Boots pino, Prisma, and BullMQ workers.
 * Runs an idempotent skill seed on startup so the api can reference stable skill IDs.
 * Ensures Qdrant collections exist before accepting embedding jobs.
 */
import Redis from 'ioredis';
import { type ConnectionOptions } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { QdrantStore, loadResolvedEmbeddingConfig } from '@careeros/embeddings';
import {
  collectionsForDim,
  QUEUE_EMBEDDING,
  QUEUE_GITHUB,
  RATE_LIMITS,
  type EmbeddingGeneratePayload,
  type GithubSyncPayload,
} from '@careeros/shared';
import { seedSkills } from './skills-seed.js';
import { handleGithubSync } from './github-sync.js';
import { handleGitlabSync, type GitlabSyncPayload } from './gitlab-sync.js';
import { handleEmbeddingGenerate, decryptEmbeddingApiKey } from './embedding-job.js';

// C-P1.6: gitlab queue name pinned in-app until packages/shared adopts a
// CodeHost split (parallel-session refactor per COMPLETION_PLAN §6).
const QUEUE_GITLAB = 'gitlab';
import {
  handleHallucinationLogRetention,
  JOB_HALLUCINATION_LOG_RETENTION,
  QUEUE_RETENTION,
} from './hallucination-log-retention.worker.js';
import {
  CORPUS_REFRESH_CRON,
  handleCorpusRefresh,
  JOB_CORPUS_REFRESH,
  QUEUE_CORPUS_REFRESH,
} from './corpus/refresh.worker.js';
import {
  handleMarketSnapshot,
  JOB_MARKET_SNAPSHOT,
  MARKET_SNAPSHOT_CRON,
  QUEUE_MARKET_SNAPSHOT,
} from './market-snapshot.worker.js';
import {
  AUDIT_LOG_RETENTION_CRON,
  handleAuditLogRetention,
  JOB_AUDIT_LOG_RETENTION,
  QUEUE_AUDIT_LOG_RETENTION,
} from './audit-log-retention.worker.js';
import {
  GMAIL_WATCH_RENEWAL_CRON,
  handleGmailWatchRenewal,
  JOB_GMAIL_WATCH_RENEWAL,
  QUEUE_GMAIL_WATCH_RENEWAL,
} from './gmail-watch-renewal.worker.js';
import {
  handleSelectorHealth,
  JOB_SELECTOR_HEALTH,
  QUEUE_SELECTOR_HEALTH,
  SELECTOR_HEALTH_CRON,
  type ProbeOutcome,
} from './selector-health.worker.js';
import {
  defaultAllowlistDir,
  loadAllowlistDir,
  probeEntry,
  type AllowlistEntry,
} from '@careeros/browser-agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installEgressProxy } from '@careeros/shared/net';
import { initSentry, captureException, flushSentry } from './sentry.js';
import { registerWorker } from './register-worker.js';
import {
  FIRECRAWL_SEARCH_CRON,
  handleFirecrawlSearch,
  JOB_FIRECRAWL_SEARCH,
  QUEUE_FIRECRAWL_SEARCH,
  type FirecrawlSearchPayload,
} from './firecrawl-search.worker.js';
import {
  handleOutreachSend,
  JOB_OUTREACH_SEND,
  QUEUE_OUTREACH_SEND,
  type OutreachSendPayload,
} from './outreach-send.worker.js';

// Error tracking first: no-op when neither SENTRY_DSN nor GLITCHTIP_DSN is set.
initSentry();

const logger = pino({
  name: 'careeros-worker',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.token', '*.apiKey', '*.password', '*.ciphertext', '*.secretKey'],
    censor: '[REDACTED]',
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }),
});

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
const qdrantUrl = process.env.QDRANT_URL ?? 'http://qdrant:6333';

// BullMQ requires maxRetriesPerRequest=null for blocking commands.
const heartbeat = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
heartbeat.on('connect', () => logger.info('redis connected'));
heartbeat.on('error', (err) => logger.error({ err: err.message }, 'redis error'));

const connection: ConnectionOptions = { url: redisUrl };
const qdrant = new QdrantStore(qdrantUrl);

async function ensureCollections(dim: number) {
  for (const c of collectionsForDim(dim)) {
    const outcome = await qdrant.ensureCollection(c.name, c.dim, {
      recreateOnMismatch: true,
      logger: { warn: (obj, msg) => logger.warn(obj, msg) },
    });
    if (outcome === 'recreated') {
      logger.warn(
        { name: c.name, dim: c.dim },
        'qdrant collection recreated at a new embedding dimension; previously stored vectors were dropped — re-enqueue embedding.generate for all sources (Settings → Re-embed)',
      );
    } else {
      logger.info({ name: c.name, dim: c.dim, outcome }, 'qdrant collection ready');
    }
  }
}

async function bootstrap() {
  // A-H8/T6: route Node global fetch through the Squid allowlist before any
  // outbound call. Fails closed if a proxy is configured but cannot be built.
  installEgressProxy();
  const seed = await seedSkills(prisma);
  logger.info(seed, 'skills seed ready');

  // Resolve the effective embedding config (app_config beats EMBEDDING_MODE) so
  // collections are created at the provider's real dimension. `external` without
  // a saved config throws here — worker startup fails loud rather than embedding
  // at the wrong size.
  const resolved = await loadResolvedEmbeddingConfig(prisma, {
    envMode: process.env.EMBEDDING_MODE,
    decryptApiKey: decryptEmbeddingApiKey,
  });
  logger.info(
    { mode: resolved.mode, model: resolved.model, dim: resolved.dim, source: resolved.source },
    'effective embedding config resolved',
  );
  await ensureCollections(resolved.dim);

  await registerWorker(
    {
      queue: QUEUE_GITHUB,
      jobName: 'sync',
      connection,
      concurrency: 2,
      handler: (data: GithubSyncPayload) => handleGithubSync(prisma, logger, data),
      unknownJobNameMessage: 'unknown github job name',
      failedMessage: 'job failed',
      completed: { message: 'job completed', include: 'data' },
    },
    logger,
  );

  await registerWorker(
    {
      queue: QUEUE_GITLAB,
      jobName: 'sync',
      connection,
      concurrency: 2,
      handler: (data: GitlabSyncPayload) => handleGitlabSync(prisma, logger, data),
      unknownJobNameMessage: 'unknown gitlab job name',
      failedMessage: 'gitlab job failed',
      completed: { message: 'gitlab job completed', include: 'data' },
    },
    logger,
  );

  await registerWorker(
    {
      queue: QUEUE_EMBEDDING,
      jobName: 'generate',
      connection,
      concurrency: 4,
      handler: (data: EmbeddingGeneratePayload) =>
        handleEmbeddingGenerate(qdrant, prisma, logger, data),
      unknownJobNameMessage: 'unknown embedding job name',
      failedMessage: 'embedding job failed',
      completed: { message: 'embedding job completed', include: 'result' },
    },
    logger,
  );

  // A-M4: daily 30-day retention on llm_hallucination_log. Repeatable job
  // registered against a static jobId so a restart is idempotent (BullMQ
  // updates the schedule rather than stacking duplicates).
  await registerWorker(
    {
      queue: QUEUE_RETENTION,
      jobName: JOB_HALLUCINATION_LOG_RETENTION,
      connection,
      // 03:17 UTC daily, off the top of the hour
      schedule: { pattern: '17 3 * * *' },
      handler: () => handleHallucinationLogRetention(prisma, logger),
      unknownJobNameMessage: 'unknown retention job name',
      failedMessage: 'retention job failed',
    },
    logger,
  );

  // C-P2.7d: weekly corpus refresh. Cron 04:00 UTC Sunday. Static jobId keeps
  // the schedule idempotent across restarts. The handler fetches every
  // registered adapter, dedupes by promptHash + embedding cosine, and inserts
  // survivors into `question_bank`.
  await registerWorker(
    {
      queue: QUEUE_CORPUS_REFRESH,
      jobName: JOB_CORPUS_REFRESH,
      connection,
      schedule: { pattern: CORPUS_REFRESH_CRON },
      handler: () => handleCorpusRefresh(prisma, qdrant, logger),
      unknownJobNameMessage: 'unknown corpus job name',
      failedMessage: 'corpus refresh job failed',
    },
    logger,
  );

  // C-P3.4d: weekly market snapshot. Monday 06:00 UTC. Static jobId keeps the
  // schedule idempotent across restarts. Writes one shared-default row plus
  // one row per user with saved job preferences.
  await registerWorker(
    {
      queue: QUEUE_MARKET_SNAPSHOT,
      jobName: JOB_MARKET_SNAPSHOT,
      connection,
      schedule: { pattern: MARKET_SNAPSHOT_CRON },
      handler: () => handleMarketSnapshot(prisma, logger),
      unknownJobNameMessage: 'unknown market-snapshot job name',
      failedMessage: 'market-snapshot job failed',
    },
    logger,
  );

  // F.6b: daily 365-day retention on `audit_log`. Cron 04:00 UTC. Calls the
  // SECURITY DEFINER stored proc `audit_log_retention_prune()` (see migration
  // 20261012000005). Static jobId keeps the schedule idempotent across worker
  // restarts.
  await registerWorker(
    {
      queue: QUEUE_AUDIT_LOG_RETENTION,
      jobName: JOB_AUDIT_LOG_RETENTION,
      connection,
      schedule: { pattern: AUDIT_LOG_RETENTION_CRON },
      handler: () => handleAuditLogRetention(prisma, logger),
      unknownJobNameMessage: 'unknown audit-log-retention job name',
      failedMessage: 'audit-log-retention job failed',
    },
    logger,
  );

  // E.4d: daily 03:00 UTC Gmail watch renewal. Static jobId keeps the schedule
  // idempotent across restarts. Watches auto-expire 7d after users.watch, so
  // running daily with a 24h renewal window guarantees at-least-one attempt.
  await registerWorker(
    {
      queue: QUEUE_GMAIL_WATCH_RENEWAL,
      jobName: JOB_GMAIL_WATCH_RENEWAL,
      connection,
      schedule: { pattern: GMAIL_WATCH_RENEWAL_CRON },
      handler: () => handleGmailWatchRenewal(prisma, logger),
      unknownJobNameMessage: 'unknown gmail-watch-renewal job name',
      failedMessage: 'gmail-watch-renewal job failed',
    },
    logger,
  );

  // F.3: weekly selector-health probe (05:00 UTC Monday). Walks every entry
  // under packages/browser-agent/allowlist/ and runs the shared probe against
  // the shipped per-domain fixture (scripts/browser-agent/__fixtures__/form-fill/
  // <domain>.html). When a probe reports unhealthy, inserts an audit_log row
  // (action='form_fill.selector_stale') via the shared markSelectorStale
  // helper. Stub entries with no field_selectors are skipped as healthy.
  //
  // ponytail: fixtures are checked into the repo and only updated by hand
  // when a real submit succeeds — a snapshot MinIO path (per plan comment)
  // is the proper upgrade when D.4 agent form-fills are landing often enough
  // for freshness to matter.
  const allowlistEntries = loadAllowlistDir(defaultAllowlistDir());
  const fixtureBase = join(
    process.cwd(),
    'scripts',
    'browser-agent',
    '__fixtures__',
    'form-fill',
  );
  const probeFromFixture = async (entry: AllowlistEntry): Promise<ProbeOutcome> => {
    // Wildcard generic entry has no canonical page to snapshot, and stub
    // domains without a fixture aren't yet wired to a real submit path, so
    // the cron treats "no fixture" as healthy-by-definition. The first time
    // a user actually triggers a submit against one of those domains, the
    // live-path failure hook (markSelectorStale with applicationId) kicks
    // in and the audit row fires per-attempt instead of weekly.
    if (entry.domain === '*') {
      return { domain: entry.domain, healthy: true, missing: [], drifted: [] };
    }
    let html = '';
    try {
      html = readFileSync(join(fixtureBase, `${entry.domain}.html`), 'utf-8');
    } catch {
      return { domain: entry.domain, healthy: true, missing: [], drifted: [] };
    }
    const r = probeEntry(entry, html);
    return { domain: r.domain, healthy: r.healthy, missing: r.missing, drifted: r.drifted };
  };

  await registerWorker(
    {
      queue: QUEUE_SELECTOR_HEALTH,
      jobName: JOB_SELECTOR_HEALTH,
      connection,
      schedule: { pattern: SELECTOR_HEALTH_CRON },
      handler: () =>
        handleSelectorHealth([...allowlistEntries.values()], probeFromFixture, prisma, logger),
      unknownJobNameMessage: 'unknown selector-health job name',
      failedMessage: 'selector-health job failed',
    },
    logger,
  );

  // F8: candidate-targeted Firecrawl sweep every 6 hours. Static jobId keeps
  // the schedule idempotent across restarts. `limiter` documents the per-host
  // Firecrawl ceiling from packages/shared/rate-limits; the handler itself
  // paces individual search calls and no-ops cleanly when the API key is unset.
  await registerWorker(
    {
      queue: QUEUE_FIRECRAWL_SEARCH,
      jobName: JOB_FIRECRAWL_SEARCH,
      connection,
      schedule: { pattern: FIRECRAWL_SEARCH_CRON },
      limiter: { max: RATE_LIMITS.firecrawl.callsPerMinute ?? 10, duration: 60_000 },
      handler: (data: FirecrawlSearchPayload) => handleFirecrawlSearch(prisma, logger, data),
      unknownJobNameMessage: 'unknown firecrawl-search job name',
      failedMessage: 'firecrawl-search job failed',
      completed: { message: 'firecrawl-search job completed', include: 'result' },
    },
    logger,
  );

  // F.5: due outreach sends. One-off jobs (not a cron): the API adds a
  // delayed job per approved outreach message with `jobId = outreach-send:<id>`
  // when the composer picked a business-hour slot. concurrency 2 + a 5/sec
  // limiter keeps us far under Gmail's 250 quota-units/sec/user (drafts.send
  // costs ~10 units) while still draining a burst.
  await registerWorker(
    {
      queue: QUEUE_OUTREACH_SEND,
      jobName: JOB_OUTREACH_SEND,
      connection,
      concurrency: 2,
      limiter: { max: 5, duration: 1_000 },
      handler: (data: OutreachSendPayload) => handleOutreachSend(prisma, logger, data),
      unknownJobNameMessage: 'unknown outreach-send job name',
      failedMessage: 'outreach-send job failed',
      completed: { message: 'outreach-send job completed', include: 'result' },
    },
    logger,
  );

  logger.info(
    `worker up, listening on queues '${QUEUE_GITHUB}', '${QUEUE_GITLAB}', '${QUEUE_EMBEDDING}', '${QUEUE_RETENTION}', '${QUEUE_CORPUS_REFRESH}', '${QUEUE_MARKET_SNAPSHOT}', '${QUEUE_AUDIT_LOG_RETENTION}', '${QUEUE_GMAIL_WATCH_RENEWAL}', '${QUEUE_SELECTOR_HEALTH}', '${QUEUE_FIRECRAWL_SEARCH}', '${QUEUE_OUTREACH_SEND}'`,
  );
}

bootstrap().catch(async (err) => {
  logger.error({ err: (err as Error).message }, 'worker bootstrap failed');
  captureException(err);
  await flushSentry();
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await prisma.$disconnect().catch(() => {});
  heartbeat.disconnect();
  await flushSentry();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
