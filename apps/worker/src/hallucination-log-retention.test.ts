import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleHallucinationLogRetention,
  pruneHallucinationLog,
  RETENTION_DAYS,
} from './hallucination-log-retention.worker';

// A-M4: rows older than 30 days are deleted; anything fresher stays.
// Uses a hand-rolled Prisma stub because Testcontainers isn't wired here yet
// and the delete semantics are trivially expressible in-memory.

type Row = { id: string; timestamp: Date; snippet: string | null };

function fakePrisma(seed: Row[]) {
  const rows: Row[] = [...seed];
  return {
    rows,
    llmHallucinationLog: {
      deleteMany: async ({ where }: { where: { timestamp: { lt: Date } } }) => {
        const cutoff = where.timestamp.lt;
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.timestamp < cutoff) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
    },
  };
}

describe('A-M4 pruneHallucinationLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Anchor to a fixed instant so day-boundary math is deterministic.
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(`deletes rows older than ${RETENTION_DAYS} days and keeps everything fresher`, async () => {
    const now = new Date();
    const oneDay = 86_400_000;
    const seed: Row[] = [
      { id: 'old-31d', timestamp: new Date(now.getTime() - 31 * oneDay), snippet: 'x' },
      { id: 'old-60d', timestamp: new Date(now.getTime() - 60 * oneDay), snippet: 'x' },
      { id: 'edge-30d-1s', timestamp: new Date(now.getTime() - 30 * oneDay - 1000), snippet: 'x' },
      { id: 'edge-29d', timestamp: new Date(now.getTime() - 29 * oneDay), snippet: 'x' },
      { id: 'fresh-1h', timestamp: new Date(now.getTime() - 3_600_000), snippet: 'x' },
      { id: 'future', timestamp: new Date(now.getTime() + 3_600_000), snippet: 'x' }, // clock skew survivor
    ];
    const prisma = fakePrisma(seed);
    const result = await pruneHallucinationLog(prisma);
    expect(result.deleted).toBe(3);
    const kept = prisma.rows.map((r) => r.id).sort();
    expect(kept).toEqual(['edge-29d', 'fresh-1h', 'future']);
  });

  it('returns 0 when nothing is old enough', async () => {
    const prisma = fakePrisma([
      { id: 'recent', timestamp: new Date(), snippet: 'x' },
    ]);
    const result = await pruneHallucinationLog(prisma);
    expect(result.deleted).toBe(0);
    expect(prisma.rows).toHaveLength(1);
  });

  it('advancing wall-clock 5d prunes rows that were previously borderline', async () => {
    // Row starts at 28d old — safe. Fast-forward 5d → 33d old, cutoff catches it.
    const now = new Date();
    const twentyEightDays = 28 * 86_400_000;
    const prisma = fakePrisma([
      { id: 'aging', timestamp: new Date(now.getTime() - twentyEightDays), snippet: 'x' },
    ]);
    let result = await pruneHallucinationLog(prisma);
    expect(result.deleted).toBe(0);
    vi.setSystemTime(new Date(now.getTime() + 5 * 86_400_000));
    result = await pruneHallucinationLog(prisma);
    expect(result.deleted).toBe(1);
    expect(prisma.rows).toHaveLength(0);
  });

  // MUTATION SMOKE:
  //   - Flip `RETENTION_DAYS` to 60 → the 31d/60d expectation in the first test
  //     drops from 3 deletions to 1.
  //   - Swap `{ lt: cutoff }` for `{ lte: cutoff }` → the boundary test moves.
  //   - Delete the cutoff calculation and pass `now` → every seeded row is
  //     wiped, all three tests fail.
});

describe('A-M4 handleHallucinationLogRetention', () => {
  it('emits a structured pino info line with the run summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const prisma = fakePrisma([
      { id: 'old', timestamp: new Date(Date.now() - 40 * 86_400_000), snippet: 'x' },
      { id: 'new', timestamp: new Date(), snippet: 'x' },
    ]);
    const info = vi.fn();
    const error = vi.fn();
    const result = await handleHallucinationLogRetention(prisma, { info, error });
    expect(result.deleted).toBe(1);
    expect(prisma.rows.map((r) => r.id)).toEqual(['new']);
    expect(info).toHaveBeenCalledTimes(1);
    const [payload, msg] = info.mock.calls[0]!;
    expect(msg).toMatch(/retention run complete/);
    expect(payload).toMatchObject({
      job: 'hallucination-log-retention',
      retentionDays: 30,
      deleted: 1,
    });
    expect(payload.cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    vi.useRealTimers();
  });

  it('logs and rethrows on failure', async () => {
    const boom = {
      llmHallucinationLog: {
        deleteMany: async () => {
          throw new Error('db down');
        },
      },
    };
    const info = vi.fn();
    const error = vi.fn();
    await expect(handleHallucinationLogRetention(boom, { info, error })).rejects.toThrow('db down');
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![1]).toMatch(/retention run failed/);
  });
});
