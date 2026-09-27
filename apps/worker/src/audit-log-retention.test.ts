import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_LOG_RETENTION_CRON,
  AUDIT_LOG_RETENTION_DAYS,
  handleAuditLogRetention,
  pruneAuditLog,
} from './audit-log-retention.worker';

// F.6b unit test: the worker delegates to the SECURITY DEFINER stored proc
// via `$queryRawUnsafe`, so we stub the raw-query surface and assert the SQL
// shape + the pino log line. Integration test (append-only-integration.test.ts)
// exercises the real proc against a Postgres testcontainer.

function fakePrisma(returned: number | bigint) {
  const calls: string[] = [];
  return {
    calls,
    $queryRawUnsafe: async (sql: string) => {
      calls.push(sql);
      return [{ audit_log_retention_prune: returned }];
    },
  };
}

describe('F.6b pruneAuditLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T04:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('calls the stored proc and returns the reported count', async () => {
    const prisma = fakePrisma(7);
    const result = await pruneAuditLog(prisma);
    expect(prisma.calls).toHaveLength(1);
    expect(prisma.calls[0]).toMatch(/audit_log_retention_prune\(\)/);
    expect(result.deleted).toBe(7);
    // Cutoff = now - 365d. On 2026-10-12 that lands on 2025-10-12.
    expect(result.cutoff.startsWith('2025-10-12')).toBe(true);
  });

  it('coerces bigint proc results to Number', async () => {
    const prisma = fakePrisma(BigInt(42));
    const result = await pruneAuditLog(prisma);
    expect(result.deleted).toBe(42);
    expect(typeof result.deleted).toBe('number');
  });

  it('returns 0 when the proc reports no rows removed', async () => {
    const prisma = fakePrisma(0);
    const result = await pruneAuditLog(prisma);
    expect(result.deleted).toBe(0);
  });

  // Sanity: constants match the migration and plan.
  it('is pinned to 365 days and 04:00 UTC daily', () => {
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(365);
    expect(AUDIT_LOG_RETENTION_CRON).toBe('0 4 * * *');
  });
});

describe('F.6b handleAuditLogRetention', () => {
  it('emits a structured pino summary line', async () => {
    const prisma = fakePrisma(3);
    const info = vi.fn();
    const error = vi.fn();
    const result = await handleAuditLogRetention(prisma, { info, error });
    expect(result.deleted).toBe(3);
    expect(info).toHaveBeenCalledOnce();
    const [payload, msg] = info.mock.calls[0]!;
    expect(msg).toMatch(/audit-log retention run complete/);
    expect(payload).toMatchObject({
      job: 'audit-log-retention',
      deleted: 3,
    });
    expect(payload.cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs and rethrows on proc failure', async () => {
    const boom = {
      $queryRawUnsafe: async () => {
        throw new Error('proc missing');
      },
    };
    const info = vi.fn();
    const error = vi.fn();
    await expect(handleAuditLogRetention(boom, { info, error })).rejects.toThrow('proc missing');
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![1]).toMatch(/retention run failed/);
  });
});
