/**
 * Worker entrypoint. Boots pino, Prisma, and BullMQ workers.
 * Runs an idempotent skill seed on startup so the api can reference stable skill IDs.
 * Ensures Qdrant collections exist before accepting embedding jobs.
 */
import Redis from 'ioredis';
import { Worker, type ConnectionOptions } from 'bullmq';
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
import { handleEmbeddingGenerate } from './embedding-job.js';

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

  logger.info(`worker up, listening on queues '${QUEUE_GITHUB}', '${QUEUE_EMBEDDING}'`);
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
