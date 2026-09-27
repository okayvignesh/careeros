import type { NormalizedJob } from './normalize';

export interface FreshnessOpts {
  /** Hard reject when the posting is older than this many days. */
  maxAgeDays: number;
  /**
   * Optional warning threshold. If provided AND the job is older than this
   * but still within `maxAgeDays`, the row is `fresh: true, reason: 'aging'`.
   * Left undefined → no aging warning is emitted.
   */
  agingDays?: number;
  /**
   * Reference "now" for testability. Defaults to `Date.now()`. Accepts either
   * a Date or a millisecond timestamp.
   */
  now?: Date | number;
}

export type FreshnessReason = 'stale' | 'aging';

export interface FreshnessResult {
  fresh: boolean;
  reason?: FreshnessReason;
  /** Age in whole ms used for the decision (may be 0 for undated rows). */
  ageMs: number;
}

const DAY_MS = 86_400_000;

/**
 * Pure freshness gate. Extracted from jobs.service `list()`'s `staleCutoff`
 * filter and its `aging` badge. `sourcePostedAt` wins when present; falls back
 * to `firstSeenAt`-equivalent. Callers pass whichever timestamp represents
 * "when this posting is dated" — the service uses `sourcePostedAt ?? firstSeenAt`.
 *
 * Behavior copied verbatim from the pre-refactor service:
 *   - `postedMs < (nowMs - maxAgeDays * DAY_MS)` → `{ fresh: false, reason: 'stale' }`
 *     (STRICT less-than — exactly-at-cutoff is still fresh, matching the
 *      `postedMs < staleCutoff` comparison in the old `list()` filter.)
 *   - if `agingDays` provided AND `nowMs - postedMs > agingDays * DAY_MS`
 *     → `{ fresh: true, reason: 'aging' }` (also strict — matches
 *     `nowMs - postedMs > AGING_DAYS * DAY_MS` from the old `list()`)
 *   - otherwise `{ fresh: true }`
 */
export function freshness(
  job: Pick<NormalizedJob, 'sourcePostedAt'> & { firstSeenAt?: Date | null },
  opts: FreshnessOpts,
): FreshnessResult {
  const nowMs = toMs(opts.now ?? Date.now());
  const posted = job.sourcePostedAt ?? job.firstSeenAt ?? null;
  const postedMs = posted ? posted.getTime() : nowMs;
  const ageMs = nowMs - postedMs;
  const staleCutoffMs = nowMs - opts.maxAgeDays * DAY_MS;
  if (postedMs < staleCutoffMs) {
    return { fresh: false, reason: 'stale', ageMs };
  }
  if (opts.agingDays !== undefined && ageMs > opts.agingDays * DAY_MS) {
    return { fresh: true, reason: 'aging', ageMs };
  }
  return { fresh: true, ageMs };
}

function toMs(x: Date | number): number {
  return typeof x === 'number' ? x : x.getTime();
}
