import { describe, expect, it, vi } from 'vitest';
import {
  createGuardedHandler,
  makeCompletedListener,
  makeFailedListener,
  scheduleRepeatable,
  type RepeatableQueue,
} from './register-worker';

// Unit tests for the extracted registration helper. Queue/Worker are replaced
// with structural fakes — nothing here touches Redis.

describe('scheduleRepeatable', () => {
  it('enqueues with a static jobId and the exact retention options', async () => {
    const calls: Array<Parameters<RepeatableQueue['add']>> = [];
    const queue: RepeatableQueue = {
      add: async (...args) => {
        calls.push(args);
        return {};
      },
    };

    await scheduleRepeatable(queue, 'hallucination-log-retention', { pattern: '17 3 * * *' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'hallucination-log-retention',
      {},
      {
        jobId: 'repeat:hallucination-log-retention',
        repeat: { pattern: '17 3 * * *' },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
      },
    ]);
  });
});

describe('createGuardedHandler', () => {
  it('ignores + warns on an unknown job name and never calls the handler', async () => {
    const warn = vi.fn();
    const handler = vi.fn(async () => ({ ok: true }));
    const process = createGuardedHandler(
      {
        jobName: 'sync',
        handler,
        unknownJobNameMessage: 'unknown github job name',
      },
      { warn },
    );

    const result = await process({ name: 'not-sync', data: { userId: 'u1' } });

    expect(result).toEqual({ skipped: true });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({ name: 'not-sync' }, 'unknown github job name');
  });

  it('invokes the handler with job.data on a matching job name', async () => {
    const warn = vi.fn();
    const handler = vi.fn(async (data: { userId: string }) => ({ repos: data.userId }));
    const process = createGuardedHandler(
      {
        jobName: 'sync',
        handler,
        unknownJobNameMessage: 'unknown github job name',
      },
      { warn },
    );

    const result = await process({ name: 'sync', data: { userId: 'u1' } });

    expect(result).toEqual({ repos: 'u1' });
    expect(handler).toHaveBeenCalledWith({ userId: 'u1' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('makeFailedListener', () => {
  it('logs the job id + error message under the configured line', () => {
    const error = vi.fn();
    const listener = makeFailedListener('job failed', { error });

    listener({ id: 'j1' }, new Error('boom'));

    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith({ id: 'j1', err: 'boom' }, 'job failed');
  });

  it('tolerates a missing job', () => {
    const error = vi.fn();
    const listener = makeFailedListener('job failed', { error });

    listener(undefined, new Error('gone'));

    expect(error).toHaveBeenCalledWith({ id: undefined, err: 'gone' }, 'job failed');
  });
});

describe('makeCompletedListener', () => {
  it("logs job.data when include is 'data'", () => {
    const info = vi.fn();
    const listener = makeCompletedListener(
      { message: 'job completed', include: 'data' },
      { info },
    );

    listener({ id: 'j1', name: 'sync', data: { userId: 'u1' } }, { ignored: true });

    expect(info).toHaveBeenCalledWith(
      { id: 'j1', name: 'sync', data: { userId: 'u1' } },
      'job completed',
    );
  });

  it("logs the handler result when include is 'result'", () => {
    const info = vi.fn();
    const listener = makeCompletedListener(
      { message: 'embedding job completed', include: 'result' },
      { info },
    );

    listener({ id: 'j2', name: 'generate', data: {} }, { chunks: 3 });

    expect(info).toHaveBeenCalledWith(
      { id: 'j2', name: 'generate', result: { chunks: 3 } },
      'embedding job completed',
    );
  });
});
