import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Queue, type ConnectionOptions } from 'bullmq';
import {
  QUEUE_EMBEDDING,
  QUEUE_GITHUB,
  QUEUE_GITLAB,
  type EmbeddingGeneratePayload,
  type EmbeddingJobName,
  type GithubJobName,
  type GithubSyncPayload,
  type GitlabJobName,
  type GitlabSyncPayload,
} from '@careeros/shared';

// backlog:#74 - gitlab queue definitions moved to packages/shared/queues.ts
// so producer (api) and consumer (worker) import the same source of truth.
export { QUEUE_GITLAB, type GitlabJobName, type GitlabSyncPayload };

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: ConnectionOptions;
  private readonly github: Queue<GithubSyncPayload, unknown, GithubJobName>;
  private readonly gitlab: Queue<GitlabSyncPayload, unknown, GitlabJobName>;
  private readonly embedding: Queue<EmbeddingGeneratePayload, unknown, EmbeddingJobName>;

  constructor(@InjectPinoLogger(QueueService.name) private readonly logger: PinoLogger) {
    this.connection = { url: process.env.REDIS_URL ?? 'redis://redis:6379' };
    this.github = new Queue<GithubSyncPayload, unknown, GithubJobName>(QUEUE_GITHUB, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
    this.gitlab = new Queue<GitlabSyncPayload, unknown, GitlabJobName>(QUEUE_GITLAB, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
    this.embedding = new Queue<EmbeddingGeneratePayload, unknown, EmbeddingJobName>(
      QUEUE_EMBEDDING,
      {
        connection: this.connection,
        defaultJobOptions: {
          // Embedding is CPU-bound, cheap to retry. Batch overload is more of a risk than
          // rate limits at this scale.
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      },
    );
  }

  async enqueueGithubSync(payload: GithubSyncPayload): Promise<void> {
    // BullMQ 5.81+ rejects `:` in custom jobIds (Redis key-separator
    // collision). Use `-` so dedup semantics stay intact: scheduled runs
    // dedupe by userId, manual retries get a fresh timestamp suffix.
    const jobId =
      payload.reason === 'manual'
        ? `sync-${payload.userId}-${Date.now()}`
        : `sync-${payload.userId}`;
    const job = await this.github.add('sync', payload, { jobId });
    this.logger.info(
      { jobId: job.id, userId: payload.userId, reason: payload.reason },
      'enqueued github.sync',
    );
  }

  async enqueueGitlabSync(payload: GitlabSyncPayload): Promise<void> {
    const jobId =
      payload.reason === 'manual'
        ? `sync-${payload.userId}-${Date.now()}`
        : `sync-${payload.userId}`;
    const job = await this.gitlab.add('sync', payload, { jobId });
    this.logger.info(
      { jobId: job.id, userId: payload.userId, reason: payload.reason },
      'enqueued gitlab.sync',
    );
  }

  async enqueueEmbedding(payload: EmbeddingGeneratePayload): Promise<void> {
    // Dedupe waiting jobs by (collection, sourceId): re-enqueuing while an identical job
    // sits in the waiting queue is a no-op. Once the earlier job completes and ages out
    // of `removeOnComplete: 200`, the same jobId is free to run again — which is exactly
    // what we want for re-embed after a content edit.
    // BullMQ 5.81+ rejects `:` in custom jobIds. `-` keeps the dedup key
    // stable per (collection, sourceId).
    const jobId = `embed-${payload.collection}-${payload.sourceId}`;
    const job = await this.embedding.add('generate', payload, { jobId });
    this.logger.info(
      {
        jobId: job.id,
        userId: payload.userId,
        collection: payload.collection,
        sourceId: payload.sourceId,
        sensitivity: payload.sensitivity,
      },
      'enqueued embedding.generate',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.github.close();
    await this.gitlab.close();
    await this.embedding.close();
  }

  // --- stats + admin ---

  private queueByName(name: string): Queue<unknown, unknown, string> {
    if (name === QUEUE_GITHUB) return this.github as unknown as Queue<unknown, unknown, string>;
    if (name === QUEUE_GITLAB) return this.gitlab as unknown as Queue<unknown, unknown, string>;
    if (name === QUEUE_EMBEDDING) return this.embedding as unknown as Queue<unknown, unknown, string>;
    throw new Error(`unknown queue: ${name}`);
  }

  async stats(): Promise<Array<{ name: string; counts: Record<string, number>; isPaused: boolean }>> {
    const queues = [QUEUE_GITHUB, QUEUE_GITLAB, QUEUE_EMBEDDING];
    return Promise.all(
      queues.map(async (name) => {
        const q = this.queueByName(name);
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const isPaused = await q.isPaused();
        return { name, counts: counts as Record<string, number>, isPaused };
      }),
    );
  }

  async listFailed(name: string, limit = 20) {
    const q = this.queueByName(name);
    const jobs = await q.getFailed(0, limit - 1);
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason,
      timestamp: j.timestamp,
      data: j.data as unknown,
    }));
  }

  async retryAllFailed(name: string): Promise<number> {
    const q = this.queueByName(name);
    const jobs = await q.getFailed(0, 500);
    let retried = 0;
    for (const j of jobs) {
      await j.retry();
      retried += 1;
    }
    return retried;
  }

  async setPaused(name: string, paused: boolean): Promise<void> {
    const q = this.queueByName(name);
    if (paused) await q.pause();
    else await q.resume();
  }
}
