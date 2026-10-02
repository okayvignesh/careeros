// Shared BullMQ worker registration. Collapses the per-queue boilerplate in
// main.ts (queue/worker construction, unknown-job-name guard, idempotent
// repeatable scheduling, failure logging) into one declarative helper while
// preserving the exact cron patterns, jobIds, retention options and log lines.
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

export interface RepeatableSchedule {
  pattern: string;
}

export interface CompletedLog {
  message: string;
  /** 'data' logs job.data (sync jobs); 'result' logs the handler return value. */
  include: 'data' | 'result';
}

export type WorkerLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

export interface RegisterWorkerOptions<TData, TResult> {
  /** BullMQ queue name. */
  queue: string;
  /** Job name this worker accepts; anything else is skipped + warned. */
  jobName: string;
  connection: ConnectionOptions;
  handler: (data: TData) => Promise<TResult>;
  /** Omit for one-off queues enqueued elsewhere (github/gitlab/embedding). */
  schedule?: RepeatableSchedule;
  concurrency?: number;
  limiter?: { max: number; duration: number };
  unknownJobNameMessage: string;
  failedMessage: string;
  completed?: CompletedLog;
}

export interface JobLike<TData> {
  name: string;
  data: TData;
}

export type GuardedHandler<TData, TResult> = (
  job: JobLike<TData>,
) => Promise<TResult | { skipped: true }>;

/**
 * Processor that only runs `handler` for the expected `jobName`. Unknown job
 * names are warned and answered with `{ skipped: true }` — matching the guard
 * that was previously inlined per queue in main.ts.
 */
export function createGuardedHandler<TData, TResult>(
  options: {
    jobName: string;
    handler: (data: TData) => Promise<TResult>;
    unknownJobNameMessage: string;
  },
  logger: Pick<Logger, 'warn'>,
): GuardedHandler<TData, TResult> {
  return async (job) => {
    if (job.name !== options.jobName) {
      logger.warn({ name: job.name }, options.unknownJobNameMessage);
      return { skipped: true };
    }
    return options.handler(job.data);
  };
}

/** Structural slice of `Queue.add` so tests can stub without a Redis server. */
export interface RepeatableQueue {
  add(
    name: string,
    data: object,
    opts: {
      jobId: string;
      repeat: { pattern: string };
      removeOnComplete: { count: number };
      removeOnFail: { count: number };
    },
  ): Promise<unknown>;
}

/**
 * Idempotent repeatable scheduling: a static `jobId` makes a restart update
 * the existing schedule instead of stacking a duplicate. Keeps the 30/30
 * retention window used by every cron queue.
 */
export async function scheduleRepeatable(
  queue: RepeatableQueue,
  jobName: string,
  schedule: RepeatableSchedule,
): Promise<void> {
  await queue.add(jobName, {}, {
    jobId: `repeat:${jobName}`,
    repeat: { pattern: schedule.pattern },
    removeOnComplete: { count: 30 },
    removeOnFail: { count: 30 },
  });
}

/** Listener factory so the failure log line can be unit-tested in isolation. */
export function makeFailedListener(
  message: string,
  logger: Pick<Logger, 'error'>,
): (job: { id?: string } | undefined, err: Error) => void {
  return (job, err) => {
    logger.error({ id: job?.id, err: err.message }, message);
  };
}

/** Listener factory for completion logs; payload shape is chosen by `include`. */
export function makeCompletedListener<TData, TResult>(
  completed: CompletedLog,
  logger: Pick<Logger, 'info'>,
): (job: { id?: string; name: string; data: TData }, result: TResult) => void {
  return (job, result) => {
    const ctx =
      completed.include === 'result'
        ? { id: job.id, name: job.name, result }
        : { id: job.id, name: job.name, data: job.data };
    logger.info(ctx, completed.message);
  };
}

/**
 * Register one queue's producer (optional) + worker. Boot order mirrors the
 * previous inline code: schedule the repeatable first, then start the worker.
 */
export async function registerWorker<TData, TResult>(
  options: RegisterWorkerOptions<TData, TResult>,
  logger: WorkerLogger,
): Promise<Worker<TData, TResult | { skipped: true }>> {
  if (options.schedule) {
    const producer = new Queue(options.queue, { connection: options.connection });
    await scheduleRepeatable(producer, options.jobName, options.schedule);
  }

  const guarded = createGuardedHandler<TData, TResult>(
    {
      jobName: options.jobName,
      handler: options.handler,
      unknownJobNameMessage: options.unknownJobNameMessage,
    },
    logger,
  );

  const workerOptions: {
    connection: ConnectionOptions;
    concurrency: number;
    limiter?: { max: number; duration: number };
  } = {
    connection: options.connection,
    concurrency: options.concurrency ?? 1,
  };
  if (options.limiter) workerOptions.limiter = options.limiter;

  const worker = new Worker<TData, TResult | { skipped: true }>(
    options.queue,
    guarded,
    workerOptions,
  );

  worker.on('failed', makeFailedListener(options.failedMessage, logger));
  if (options.completed) {
    worker.on('completed', makeCompletedListener(options.completed, logger));
  }

  return worker;
}
