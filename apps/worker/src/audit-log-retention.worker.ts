// F.6b (Wave F / P6 controlled execution): daily audit_log retention.
//
// The `audit_log` table is append-only at the DB layer (see migration
// 20261012000005): app role `careeros` has UPDATE/DELETE revoked. This
// worker enforces the 365-day retention window from
// plan/phase-6-controlled-execution.md#74 by calling stored proc
// `audit_log_retention_prune()`. The proc is SECURITY DEFINER and runs as
// the DB owner, so the DELETE succeeds even though the worker connects as
// `careeros`.
//
// Runs daily at 04:00 UTC via a BullMQ repeatable job. Repeatable jobId is
// static so a fresh worker container is enough to bring the schedule back
// up; BullMQ replaces the schedule rather than stacking duplicates.
import type { Logger } from 'pino';

export const QUEUE_AUDIT_LOG_RETENTION = 'audit-log-retention';
export const JOB_AUDIT_LOG_RETENTION = 'audit-log-retention';
export const AUDIT_LOG_RETENTION_CRON = '0 4 * * *'; // 04:00 UTC daily
export const AUDIT_LOG_RETENTION_DAYS = 365;

// ponytail: structural type for the one $queryRaw call this worker makes.
// Keeps the test stub free of Prisma's generic client type.
export interface AuditLogRetentionRepo {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

export interface RetentionResult {
  cutoff: string;
  deleted: number;
}

/**
 * Invoke the stored proc `audit_log_retention_prune()`. Returns the deleted
 * row count reported by the proc (via `RETURN removed;`) plus the ISO cutoff
 * the proc used, computed here in JS from `now` for the pino summary. The
 * proc computes its own cutoff server-side; the value returned here is
 * illustrative and drift versus the DB clock is bounded by wall-clock skew.
 */
export async function pruneAuditLog(
  prisma: AuditLogRetentionRepo,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 86_400_000);
  const rows = await prisma.$queryRawUnsafe<Array<{ audit_log_retention_prune: bigint | number }>>(
    'SELECT audit_log_retention_prune() AS audit_log_retention_prune',
  );
  const raw = rows[0]?.audit_log_retention_prune ?? 0;
  const deleted = typeof raw === 'bigint' ? Number(raw) : raw;
  return { cutoff: cutoff.toISOString(), deleted };
}

/**
 * Job handler. Wraps `pruneAuditLog` with pino structured logging: the
 * summary line IS the audit surface (we don't insert an `audit_log` row per
 * prune because that would defeat the point).
 */
export async function handleAuditLogRetention(
  prisma: AuditLogRetentionRepo,
  logger: Pick<Logger, 'info' | 'error'>,
): Promise<RetentionResult> {
  try {
    const result = await pruneAuditLog(prisma);
    logger.info(
      {
        job: JOB_AUDIT_LOG_RETENTION,
        cutoff: result.cutoff,
        deleted: result.deleted,
      },
      'audit-log retention run complete',
    );
    return result;
  } catch (err) {
    logger.error(
      { job: JOB_AUDIT_LOG_RETENTION, err: (err as Error).message },
      'audit-log retention run failed',
    );
    throw err;
  }
}
