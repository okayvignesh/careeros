import { createHash } from 'node:crypto';

/**
 * `promptHash` shape matches `apps/api/src/modules/corpus/corpus.service.ts`:
 * sha256(body) truncated to 32 hex chars. Same-body rows on either pipeline
 * (worker cron or API on-demand sync) map to the same hash → the unique
 * constraint on `question_bank.promptHash` dedupes across writers.
 */
export function hashPrompt(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
