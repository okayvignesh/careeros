import type { NormalizedJob } from './normalize';

/**
 * C-P3.2a: verification verdict + reject-log gate.
 *
 * Extends the B-10 stub: verdicts are now three-tiered
 *   - `trusted`  — passed every rule
 *   - `flagged`  — soft-fail; still enters the pool but shown with a warning
 *   - `rejected` — hard-fail; never enters `jobs_normalized`, written to
 *                  `job_reject_log` with the reason list for operator audit.
 *
 * Highest-severity verdict wins: any `rejected` reason → verdict=`rejected`,
 * else any `flagged` reason → verdict=`flagged`, else `trusted`. Reasons
 * always accumulate (no early return) so the reject-log UI can show the full
 * picture — a listing that fails multiple checks is a stronger signal.
 *
 * All rules are pure heuristics. No LLM, no network. Adding a new rule is
 * one call to `add(severity, reason, predicate)`.
 */

export type VerifyVerdict = 'trusted' | 'flagged' | 'rejected';

export interface VerifyOpts {
  /**
   * Adapter ids the caller considers Tier-1 VERIFIED ATS (Ashby, Greenhouse,
   * ...). A row from an unlisted source stays `trusted` if it passes all rules
   * (aggregator content is usable), but the source ends up in the trust-order
   * merge stage's secondary sort. If empty (default), the source rule is a
   * no-op — verify does not down-rank an unknown source on its own.
   */
  trustedSources?: readonly string[];
  /**
   * Description char count under which we `flag thin-description`. Default 50
   * per spec — a one-liner is likely a stub or scrape failure.
   */
  minDescriptionChars?: number;
  /**
   * Freshness ceiling in days. Postings older than this are `rejected stale`.
   * Default 90 per spec — an older post is almost always filled or closed.
   */
  maxAgeDays?: number;
  /**
   * Milliseconds-since-epoch override for tests. Defaults to `Date.now()`.
   */
  now?: number;
  /**
   * Extra reject-blocklist tokens (case-insensitive substrings). Matched
   * against title + company + description. Adds to `DEFAULT_REJECT_BLOCKLIST`.
   */
  rejectBlocklist?: readonly string[];
}

export interface VerifyResult {
  verdict: VerifyVerdict;
  reasons: string[];
}

const DEFAULT_MIN_DESC = 50;
const DEFAULT_MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * Absurd-salary bounds in USD/year equivalent. Below is more than "part-time
 * grad-student" territory; above is either a typo or comp-fraud bait. The
 * band is deliberately wide so real senior comp (up to ~$900k for staff+ at
 * frontier labs) does NOT trip it.
 */
const MIN_ANNUAL_USD = 10 /* $/hr */ * 2080; // ≈ $20,800/yr
const MAX_ANNUAL_USD = 1_000_000;

/**
 * Reject-blocklist tokens. Scam/MLM/crypto patterns copied from the manual
 * moderation notes we accumulated during Remotive testing. Case-insensitive
 * substring match — a listing with any of these anywhere is rejected outright.
 *
 * ponytail: hand-curated list, no ML. Grow only when a real listing sneaks
 * through and the operator adds the token to `rejectBlocklist` opts. Move to
 * DB-backed config when the list grows past ~30 or per-user overrides matter.
 */
const DEFAULT_REJECT_BLOCKLIST: readonly string[] = [
  'earn crypto',
  'crypto giveaway',
  'guaranteed income',
  'work from home mlm',
  'no experience needed high pay',
  'be your own boss',
  'financial freedom opportunity',
  'pyramid',
  '$$$ weekly',
];

interface Rule {
  severity: 'flag' | 'reject';
  reason: string;
}

/**
 * Verify one normalized job. Returns the highest-severity verdict + every
 * reason that fired. Pure; no IO.
 *
 * Rule list (severity → reason string):
 *   reject : blank-title
 *   flag   : blank-company
 *   flag   : thin-description
 *   flag   : absurd-salary
 *   reject : stale
 *   reject : blocklist:<token>
 *   flag   : all-caps-title
 *   flag   : bot-whitespace
 *   flag   : non-http-url         (bumped from B-10 stub — a bad URL isn't a
 *                                  hard-reject: some legit ATS jobs surface
 *                                  with `mailto:` or missing scheme, still
 *                                  worth flagging for review)
 *   flag   : unverified-source    (only when trustedSources non-empty)
 */
export function verify(job: NormalizedJob, opts: VerifyOpts = {}): VerifyResult {
  const minDesc = opts.minDescriptionChars ?? DEFAULT_MIN_DESC;
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const nowMs = opts.now ?? Date.now();
  const trusted = new Set(opts.trustedSources ?? []);
  const blocklist = [...DEFAULT_REJECT_BLOCKLIST, ...(opts.rejectBlocklist ?? [])];

  const hits: Rule[] = [];

  if (job.title.trim().length === 0) {
    hits.push({ severity: 'reject', reason: 'blank-title' });
  }
  if (job.company.trim().length === 0) {
    hits.push({ severity: 'flag', reason: 'blank-company' });
  }
  if (job.description.trim().length < minDesc) {
    hits.push({ severity: 'flag', reason: 'thin-description' });
  }
  if (isAbsurdSalary(job)) {
    hits.push({ severity: 'flag', reason: 'absurd-salary' });
  }
  if (isStale(job.sourcePostedAt, maxAgeDays, nowMs)) {
    hits.push({ severity: 'reject', reason: 'stale' });
  }
  for (const token of blocklist) {
    if (matchesBlocklist(job, token)) {
      hits.push({ severity: 'reject', reason: `blocklist:${token}` });
    }
  }
  if (isAllCapsTitle(job.title)) {
    hits.push({ severity: 'flag', reason: 'all-caps-title' });
  }
  if (hasBotWhitespace(job.description)) {
    hits.push({ severity: 'flag', reason: 'bot-whitespace' });
  }
  if (!isHttpUrl(job.canonicalUrl)) {
    hits.push({ severity: 'flag', reason: 'non-http-url' });
  }
  if (trusted.size > 0 && !trusted.has(job.primarySource)) {
    hits.push({ severity: 'flag', reason: 'unverified-source' });
  }

  const verdict: VerifyVerdict = hits.some((h) => h.severity === 'reject')
    ? 'rejected'
    : hits.length > 0
      ? 'flagged'
      : 'trusted';
  return { verdict, reasons: hits.map((h) => h.reason) };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Uses `compBandUsd` (populated by normalize when the raw payload had a
 * parseable salary). Absurd if either the min or the max sits outside the
 * plausible band. Missing comp = not absurd (no signal to judge on).
 */
function isAbsurdSalary(job: NormalizedJob): boolean {
  const band = job.compBandUsd;
  if (!band) return false;
  if (band.min < MIN_ANNUAL_USD || band.min > MAX_ANNUAL_USD) return true;
  if (band.max < MIN_ANNUAL_USD || band.max > MAX_ANNUAL_USD) return true;
  return false;
}

function isStale(postedAt: Date | null, maxAgeDays: number, nowMs: number): boolean {
  if (!postedAt) return false; // no signal → don't reject; freshness stage owns null-date policy
  const ageMs = nowMs - postedAt.getTime();
  return ageMs > maxAgeDays * DAY_MS;
}

function matchesBlocklist(job: NormalizedJob, token: string): boolean {
  const needle = token.toLowerCase();
  const hay = `${job.title}\n${job.company}\n${job.description}`.toLowerCase();
  return hay.includes(needle);
}

/**
 * All-caps title = 3+ letter tokens and 80%+ of them are all uppercase.
 * Ignores punctuation and short words so "IT" or "AI" doesn't trip the whole
 * title. `SR ENGINEER (REMOTE)` → true; `Senior Engineer` → false.
 */
function isAllCapsTitle(title: string): boolean {
  const tokens = title.match(/[A-Za-z]{3,}/g) ?? [];
  if (tokens.length < 3) return false;
  const upper = tokens.filter((t) => t === t.toUpperCase()).length;
  return upper / tokens.length >= 0.8;
}

/**
 * Bot-whitespace = a run of 3+ non-single-space whitespace stretches (tabs,
 * multiple newlines, non-breaking spaces). A hand-written description has
 * paragraph breaks (single `\n\n`), a bot-scraped one often has `\n\n\n\n\n\n`
 * or triple-tab column joins. Ignores single spaces and single blank lines.
 */
function hasBotWhitespace(description: string): boolean {
  // Match runs of 3+ whitespace chars that are NOT the "single blank line"
  // pattern `\n\n`. Any run of `\s{3,}` beyond that is suspicious.
  const runs = description.match(/\s{4,}/g) ?? [];
  return runs.length >= 3;
}
