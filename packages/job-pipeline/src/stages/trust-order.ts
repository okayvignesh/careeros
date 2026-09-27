import type { NormalizedJob } from './normalize';
import { verify, type VerifyOpts, type VerifyVerdict } from './verify';

/**
 * C-P3.2b: trust-order merge.
 *
 * Sort jobs so the highest-trust, most-verified, freshest listing sits at the
 * top of the pool. Filters out `rejected` verdicts entirely — the reject-log
 * stage owns those.
 *
 * Tier map (documented per spec):
 *   1 — ATS  (ashby, greenhouse). First-party job data straight from the
 *              employer's ATS. Highest signal-to-noise.
 *   2 — Aggregator (adzuna, arbeitnow, remotive). Second-hand indexes of
 *              first-party postings. Occasionally stale, occasionally
 *              re-scraped from another aggregator.
 *   3 — Agent-scraped (default). Anything else: desktop-agent, email alert,
 *              user paste, an unmapped adapter. Lowest trust — the source
 *              hasn't proven itself in a contract test yet.
 *
 * Tie-break ladder:
 *   1. tier (asc: 1 wins over 3)
 *   2. verify verdict (trusted > flagged; rejected filtered out)
 *   3. freshness (newer sourcePostedAt first; null last)
 *
 * Stable-sort — jobs equal on every key preserve input order. Uses
 * `Array.prototype.sort` (V8 has been stable since 2019, Node 12+).
 */

export const TIER_BY_ADAPTER: Readonly<Record<string, 1 | 2 | 3>> = {
  ashby: 1,
  greenhouse: 1,
  adzuna: 2,
  arbeitnow: 2,
  remotive: 2,
};

const UNKNOWN_ADAPTER_TIER: 1 | 2 | 3 = 3;

const VERDICT_RANK: Readonly<Record<VerifyVerdict, number>> = {
  trusted: 0,
  flagged: 1,
  rejected: 2, // filtered out before sort; kept in the map so the type is total
};

export interface TrustOrderOpts extends VerifyOpts {
  /**
   * Per-adapter tier override map — merges over `TIER_BY_ADAPTER` for callers
   * (like a test fixture or a self-hosted GitLab-based adapter) that need to
   * declare a tier without shipping a change to the default map.
   */
  tierOverrides?: Readonly<Record<string, 1 | 2 | 3>>;
}

export function tierFor(
  primarySource: string,
  overrides?: Readonly<Record<string, 1 | 2 | 3>>,
): 1 | 2 | 3 {
  return overrides?.[primarySource] ?? TIER_BY_ADAPTER[primarySource] ?? UNKNOWN_ADAPTER_TIER;
}

/**
 * Stable-sort `jobs` by (tier, verdict, freshness). Rejected jobs are
 * filtered out — trust order is a pool-shaping stage, not an audit stage. The
 * reject-log persistence happens upstream against the same verify() output.
 *
 * `verify` is called once per job; verdict + reasons are NOT returned here
 * (callers who need them re-run verify or wire cross-source-dedupe before
 * this stage). Keeping the return type `NormalizedJob[]` keeps the pipeline
 * composable without a bespoke wrapper type.
 */
export function trustOrder(jobs: NormalizedJob[], opts: TrustOrderOpts = {}): NormalizedJob[] {
  const { tierOverrides, ...verifyOpts } = opts;
  const keyed = jobs
    .map((job) => {
      const v = verify(job, verifyOpts);
      return {
        job,
        tier: tierFor(job.primarySource, tierOverrides),
        verdictRank: VERDICT_RANK[v.verdict],
        // Missing sourcePostedAt sinks to the bottom of the freshness tie-break.
        // Using -Infinity sorts null last when we compare `bMs - aMs`.
        postedMs: job.sourcePostedAt ? job.sourcePostedAt.getTime() : -Infinity,
        verdict: v.verdict,
      };
    })
    .filter((k) => k.verdict !== 'rejected');

  keyed.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.verdictRank !== b.verdictRank) return a.verdictRank - b.verdictRank;
    return b.postedMs - a.postedMs; // newer first
  });

  return keyed.map((k) => k.job);
}
