import type { NormalizedJob } from './normalize';

export interface DedupeResult {
  /** First-seen occurrence of each canonicalUrl, in input order. */
  unique: NormalizedJob[];
  /** Every subsequent row whose canonicalUrl already appeared upstream. */
  duplicates: NormalizedJob[];
}

/**
 * In-batch dedupe by canonicalUrl. Preserves input order for `unique`. The
 * FIRST occurrence wins — matches the "append-only jobs_raw + upsert by
 * canonicalUrl" DB contract in `jobs.service.sync()` where the second insert
 * would upsert the first (which is fine, but wastes an LLM extraction round).
 *
 * ponytail: exact-URL match only. Cross-source fuzzy dedupe (title+company
 * near-match, tracking-param strip) lands with the P3 trust-order merge stage
 * (§9 Stage-4 in blueprint).
 */
export function dedupe(normalized: NormalizedJob[]): DedupeResult {
  const seen = new Set<string>();
  const unique: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];
  for (const n of normalized) {
    if (seen.has(n.canonicalUrl)) {
      duplicates.push(n);
    } else {
      seen.add(n.canonicalUrl);
      unique.push(n);
    }
  }
  return { unique, duplicates };
}
