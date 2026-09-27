/**
 * Worker entrypoint. Boots pino, Prisma, and BullMQ workers.
 * Runs an idempotent skill seed on startup so the api can reference stable skill IDs.
 * Ensures Qdrant collections exist before accepting embedding jobs.
 */
import Redis from 'ioredis';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { QdrantStore } from '@careeros/embeddings';
import {
  ALL_COLLECTIONS,
  QUEUE_EMBEDDING,
  QUEUE_GITHUB,
  type EmbeddingGeneratePayload,
  type GithubSyncPayload,
} from '@careeros/shared';
import { seedSkills } from './skills-seed.js';
import { handleGithubSync } from './github-sync.js';
import { handleGitlabSync, type GitlabSyncPayload } from './gitlab-sync.js';
import { handleEmbeddingGenerate } from './embedding-job.js';

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

async function ensureCollections() {
  for (const c of ALL_COLLECTIONS) {
    await qdrant.ensureCollection(c.name, c.dim);
    logger.info({ name: c.name, dim: c.dim, distance: c.distance }, 'qdrant collection ready');
  }
}

async function bootstrap() {
  const seed = await seedSkills(prisma);
  logger.info(seed, 'skills seed ready');

  await ensureCollections();

  const githubWorker = new Worker<GithubSyncPayload>(
    QUEUE_GITHUB,
    async (job) => {
      if (job.name !== 'sync') {
        logger.warn({ name: job.name }, 'unknown github job name');
        return { skipped: true };
      }
      return handleGithubSync(prisma, logger, job.data);
    },
    { connection, concurrency: 2 },
  );

  githubWorker.on('completed', (job) =>
    logger.info({ id: job.id, name: job.name, data: job.data }, 'job completed'),
  );
  githubWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'job failed'),
  );

  const gitlabWorker = new Worker<GitlabSyncPayload>(
    QUEUE_GITLAB,
    async (job) => {
      if (job.name !== 'sync') {
        logger.warn({ name: job.name }, 'unknown gitlab job name');
        return { skipped: true };
      }
      return handleGitlabSync(prisma, logger, job.data);
    },
    { connection, concurrency: 2 },
  );
  gitlabWorker.on('completed', (job) =>
    logger.info({ id: job.id, name: job.name, data: job.data }, 'gitlab job completed'),
  );
  gitlabWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'gitlab job failed'),
  );

  const embeddingWorker = new Worker<EmbeddingGeneratePayload>(
    QUEUE_EMBEDDING,
    async (job) => {
      if (job.name !== 'generate') {
        logger.warn({ name: job.name }, 'unknown embedding job name');
        return { skipped: true };
      }
      return handleEmbeddingGenerate(qdrant, logger, job.data);
    },
    { connection, concurrency: 4 },
  );

  embeddingWorker.on('completed', (job, result) =>
    logger.info({ id: job.id, name: job.name, result }, 'embedding job completed'),
  );
  embeddingWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'embedding job failed'),
  );

  // A-M4: daily 30-day retention on llm_hallucination_log. Repeatable job
  // registered against a static jobId so a restart is idempotent (BullMQ
  // updates the schedule rather than stacking duplicates).
  const retentionQueue = new Queue(QUEUE_RETENTION, { connection });
  await retentionQueue.add(
    JOB_HALLUCINATION_LOG_RETENTION,
    {},
    {
      jobId: `repeat:${JOB_HALLUCINATION_LOG_RETENTION}`,
      repeat: { pattern: '17 3 * * *' }, // 03:17 UTC daily, off the top of the hour
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  const retentionWorker = new Worker(
    QUEUE_RETENTION,
    async (job) => {
      if (job.name !== JOB_HALLUCINATION_LOG_RETENTION) {
        logger.warn({ name: job.name }, 'unknown retention job name');
        return { skipped: true };
      }
      return handleHallucinationLogRetention(prisma, logger);
    },
    { connection, concurrency: 1 },
  );
  retentionWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'retention job failed'),
  );

  // C-P2.7d: weekly corpus refresh. Cron 04:00 UTC Sunday. Static jobId keeps
  // the schedule idempotent across restarts. The handler fetches every
  // registered adapter, dedupes by promptHash + embedding cosine, and inserts
  // survivors into `question_bank`.
  const corpusQueue = new Queue(QUEUE_CORPUS_REFRESH, { connection });
  await corpusQueue.add(
    JOB_CORPUS_REFRESH,
    {},
    {
      jobId: `repeat:${JOB_CORPUS_REFRESH}`,
      repeat: { pattern: CORPUS_REFRESH_CRON },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  const corpusWorker = new Worker(
    QUEUE_CORPUS_REFRESH,
    async (job) => {
      if (job.name !== JOB_CORPUS_REFRESH) {
        logger.warn({ name: job.name }, 'unknown corpus job name');
        return { skipped: true };
      }
      return handleCorpusRefresh(prisma, qdrant, logger);
    },
    { connection, concurrency: 1 },
  );
  corpusWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'corpus refresh job failed'),
  );

  // C-P3.4d: weekly market snapshot. Monday 06:00 UTC. Static jobId keeps the
  // schedule idempotent across restarts. Writes one shared-default row plus
  // one row per user with saved job preferences.
  const snapshotQueue = new Queue(QUEUE_MARKET_SNAPSHOT, { connection });
  await snapshotQueue.add(
    JOB_MARKET_SNAPSHOT,
    {},
    {
      jobId: `repeat:${JOB_MARKET_SNAPSHOT}`,
      repeat: { pattern: MARKET_SNAPSHOT_CRON },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  const snapshotWorker = new Worker(
    QUEUE_MARKET_SNAPSHOT,
    async (job) => {
      if (job.name !== JOB_MARKET_SNAPSHOT) {
        logger.warn({ name: job.name }, 'unknown market-snapshot job name');
        return { skipped: true };
      }
      return handleMarketSnapshot(prisma, logger);
    },
    { connection, concurrency: 1 },
  );
  snapshotWorker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'market-snapshot job failed'),
  );

  logger.info(
    `worker up, listening on queues '${QUEUE_GITHUB}', '${QUEUE_GITLAB}', '${QUEUE_EMBEDDING}', '${QUEUE_RETENTION}', '${QUEUE_CORPUS_REFRESH}', '${QUEUE_MARKET_SNAPSHOT}'`,
  );
}

bootstrap().catch((err) => {
  logger.error({ err: (err as Error).message }, 'worker bootstrap failed');
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await prisma.$disconnect().catch(() => {});
  heartbeat.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
