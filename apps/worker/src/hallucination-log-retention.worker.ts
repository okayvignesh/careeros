// A-M4: llm_hallucination_log rows carry a source-text snippet (encrypted at
// rest) plus its hash + byte-offset. Keep them 30 days for eval review, then
// delete. Runs daily via a BullMQ repeatable job — the scheduler is registered
// in main.ts so a fresh worker container is enough to bring it back up.
import type { Logger } from 'pino';

export const QUEUE_RETENTION = 'retention';
export const JOB_HALLUCINATION_LOG_RETENTION = 'hallucination-log-retention';

// ponytail: narrow structural type instead of `Pick<PrismaClient, ...>` so
// tests can stub with a plain object without pulling in Prisma's Delegate
// generic. The runtime shape is identical; the type just states the two facts
// this function actually needs.
export interface HallucinationLogRepo {
  llmHallucinationLog: {
    deleteMany: (args: { where: { timestamp: { lt: Date } } }) => Promise<{ count: number }>;
  };
}

/**
 * Retention window in days. 30 was chosen because:
 *   - resume PII belongs to the user; keeping it longer than a review window
 *     is unearned risk (see security.md item 5, ai-safety.md item 9);
 *   - hallucination triage in practice happens within days of a run, not months;
 *   - short window means the eval loop can't drift on rows the model has since
 *     been retrained on.
 * If the eval team wants a per-severity longer tail, add a `keepDays` column
 * and let this worker read it. ponytail: single knob until we need two.
 */
export const RETENTION_DAYS = 30;

export interface RetentionResult {
  cutoff: string;
  deleted: number;
}

/**
 * Delete `llm_hallucination_log` rows older than `RETENTION_DAYS`.
 * Pure function of (prisma, now) so tests can drive `now` with vi.setSystemTime.
 */
export async function pruneHallucinationLog(
  prisma: HallucinationLogRepo,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.llmHallucinationLog.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  return { cutoff: cutoff.toISOString(), deleted: count };
}

/**
 * Job handler called by the BullMQ worker. Wraps `pruneHallucinationLog` with
 * pino structured logging (retention summary is the audit surface — no
 * `audit_log` row per prune because the delete count IS the audit fact).
 */
export async function handleHallucinationLogRetention(
  prisma: HallucinationLogRepo,
  logger: Pick<Logger, 'info' | 'error'>,
): Promise<RetentionResult> {
  try {
    const result = await pruneHallucinationLog(prisma);
    logger.info(
      {
        job: JOB_HALLUCINATION_LOG_RETENTION,
        retentionDays: RETENTION_DAYS,
        cutoff: result.cutoff,
        deleted: result.deleted,
      },
      'hallucination-log retention run complete',
    );
    return result;
  } catch (err) {
    logger.error(
      { job: JOB_HALLUCINATION_LOG_RETENTION, err: (err as Error).message },
      'hallucination-log retention run failed',
    );
    throw err;
  }
}
