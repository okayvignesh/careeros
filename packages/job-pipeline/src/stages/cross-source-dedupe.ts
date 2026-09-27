import { createHash } from 'node:crypto';
import type { NormalizedJob } from './normalize';
import { tierFor } from './trust-order';

/**
 * C-P3.2c: cross-source fuzzy dedupe.
 *
 * Same job posted on ashby, adzuna, and remotive → merge into one canonical
 * `unique` row (higher-tier wins) with the loser's sourceIds folded onto the
 * winner. Different jobs at the same company → kept separate.
 *
 * Match key (all three must hold):
 *   1. Company name Levenshtein distance ≤ 2 (case-insensitive, punctuation
 *      stripped) — catches "Acme Inc" ↔ "Acme, Inc." ↔ "acme inc".
 *   2. Title token overlap ≥ 0.75 — catches "Senior Backend Engineer" ↔
 *      "Senior Backend Engineer (Remote)".
 *   3. First-200-char description hash matches (whitespace collapsed).
 *      Kills last resort near-dupes where the aggregator prepended boilerplate.
 *
 * ponytail: O(n²) pairwise scan. Job pools are small in the walking-skeleton
 * era (~1k rows per sync), so this is fine; when the pool grows past ~10k
 * we swap to a blocking index on company-initial-char + first-title-token
 * before pairwise. Named ceiling.
 */

export interface CrossSourceDedupeOpts {
  /** Per-adapter tier override; passed through to `trustOrder.tierFor`. */
  tierOverrides?: Readonly<Record<string, 1 | 2 | 3>>;
  /** Max Levenshtein for company. Default 2. */
  maxCompanyDistance?: number;
  /** Min title token overlap (0..1). Default 0.75. */
  minTitleOverlap?: number;
  /** How many leading chars of description to hash. Default 200. */
  descriptionHashChars?: number;
}

export interface DuplicatePair {
  /** The row that won the merge (higher tier / earlier index). */
  winner: NormalizedJob;
  /** The row that got folded onto the winner. */
  loser: NormalizedJob;
}

export interface CrossSourceDedupeResult {
  /** Deduped rows — one per canonical job. Same object identity as the input winner. */
  unique: NormalizedJob[];
  /** Every loser row (verbatim) so the reject-log can show what was merged away. */
  duplicates: DuplicatePair[];
  /**
   * Per-winner accumulated sourceTag list: `[winner.sourceTag, ...loser sourceTags]`.
   * The service layer persists this to `NormalizedJob.sourceIds`. Kept off the
   * NormalizedJob shape itself because sourceIds is a DB-owned column that
   * gets merged with existing DB rows in `jobs.service.sync` — the dedupe
   * stage only knows the in-batch view.
   */
  mergedSourceTagsByWinner: Map<NormalizedJob, string[]>;
}

const DEFAULT_MAX_COMPANY_DIST = 2;
const DEFAULT_MIN_TITLE_OVERLAP = 0.75;
const DEFAULT_DESC_HASH_CHARS = 200;

/**
 * Fuzzy dedupe across sources. Preserves input order for `unique`. If two
 * rows match and are equal-tier, the first-seen wins (stable).
 */
export function crossSourceDedupe(
  jobs: NormalizedJob[],
  opts: CrossSourceDedupeOpts = {},
): CrossSourceDedupeResult {
  const maxDist = opts.maxCompanyDistance ?? DEFAULT_MAX_COMPANY_DIST;
  const minOverlap = opts.minTitleOverlap ?? DEFAULT_MIN_TITLE_OVERLAP;
  const hashChars = opts.descriptionHashChars ?? DEFAULT_DESC_HASH_CHARS;

  // Precompute per-row match keys so the O(n²) inner loop stays cheap.
  const keys = jobs.map((job) => ({
    job,
    tier: tierFor(job.primarySource, opts.tierOverrides),
    companyKey: normalizeCompany(job.company),
    titleTokens: titleTokens(job.title),
    descHash: hashDescriptionPrefix(job.description, hashChars),
    // Mutable copy of sourceIds — the winner accumulates merged losers here.
    sourceIds: [job.sourceTag],
    mergedInto: -1 as number,
  }));

  const duplicates: DuplicatePair[] = [];

  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    if (a.mergedInto !== -1) continue;
    for (let k = i + 1; k < keys.length; k++) {
      const b = keys[k]!;
      if (b.mergedInto !== -1) continue;
      if (!isMatch(a, b, maxDist, minOverlap)) continue;
      // Pick winner by tier; ties preserve input order (a wins because i<k).
      const winner = a.tier <= b.tier ? a : b;
      const loser = winner === a ? b : a;
      loser.mergedInto = keys.indexOf(winner);
      for (const tag of loser.sourceIds) {
        if (!winner.sourceIds.includes(tag)) winner.sourceIds.push(tag);
      }
      duplicates.push({ winner: winner.job, loser: loser.job });
      if (loser === a) break; // a got folded away; move on
    }
  }

  const unique: NormalizedJob[] = [];
  const mergedSourceTagsByWinner = new Map<NormalizedJob, string[]>();
  for (const k of keys) {
    if (k.mergedInto !== -1) continue;
    unique.push(k.job);
    mergedSourceTagsByWinner.set(k.job, k.sourceIds);
  }
  return { unique, duplicates, mergedSourceTagsByWinner };
}

// -------- match predicate --------

interface Row {
  job: NormalizedJob;
  companyKey: string;
  titleTokens: Set<string>;
  descHash: string;
}

function isMatch(a: Row, b: Row, maxDist: number, minOverlap: number): boolean {
  if (levenshtein(a.companyKey, b.companyKey) > maxDist) return false;
  if (jaccard(a.titleTokens, b.titleTokens) < minOverlap) return false;
  if (a.descHash !== b.descHash) return false;
  return true;
}

// -------- normalizers --------

function normalizeCompany(raw: string): string {
  // Strip punctuation, collapse whitespace, lowercase. "Acme, Inc." → "acme inc"
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

function hashDescriptionPrefix(description: string, chars: number): string {
  const collapsed = description.replace(/\s+/g, ' ').trim().slice(0, chars);
  return createHash('sha256').update(collapsed).digest('hex');
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Iterative two-row Levenshtein (Wagner-Fischer). O(len(a) * len(b)) time,
 * O(min) space. Inline because js-levenshtein pulls a package for 30 lines.
 * ponytail: iterative + two rows, not the full matrix; already O(mn) which
 * is fine for company names (< 100 chars).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure `a` is the shorter one so we use less memory.
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array<number>(a.length + 1);
  let curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1]! + 1, // insertion
        prev[i]! + 1, // deletion
        prev[i - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length]!;
}
