// Relevance filter — pure pipeline stage. Moved out of the inline filter
// previously buried in JobsService.list so every source funnels through the
// package (AGENTS.md §12: … verify → relevance filter → match score → land).
//
// Evaluated in the same order as the old inline filter so `job_reject_log`
// reason codes and the listing's reject counters stay byte-identical:
// stale → remote-only → company-blacklisted → has-dealbreaker → must-have-missing.
import { freshness } from './freshness';

export interface RelevancePrefs {
  remoteOnly: boolean;
  mustHaveSkills: readonly string[];
  dealbreakerSkills: readonly string[];
  companyBlacklist: readonly string[];
}

export interface RelevanceJob {
  company: string;
  remote: boolean;
  skillIds: readonly string[];
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
}

export interface RelevanceOpts {
  /** Passed to the freshness gate; defaults to 45 like the old list filter. */
  maxAgeDays?: number;
  /** Reference "now" for testability. Defaults to `Date.now()` in freshness. */
  now?: Date | number;
}

export type RelevanceReason =
  | 'stale'
  | 'remote-only'
  | 'company-blacklisted'
  | 'has-dealbreaker'
  | 'must-have-missing';

export interface RelevanceResult {
  relevant: boolean;
  reason?: RelevanceReason;
}

const DEFAULT_MAX_AGE_DAYS = 45;

export function relevance(
  job: RelevanceJob,
  prefs: RelevancePrefs,
  opts: RelevanceOpts = {},
): RelevanceResult {
  const fresh = freshness(
    { sourcePostedAt: job.sourcePostedAt, firstSeenAt: job.firstSeenAt },
    opts.now === undefined
      ? { maxAgeDays: opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS }
      : { maxAgeDays: opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS, now: opts.now },
  );
  if (!fresh.fresh) return { relevant: false, reason: 'stale' };

  if (prefs.remoteOnly && !job.remote) return { relevant: false, reason: 'remote-only' };

  const blacklist = new Set(prefs.companyBlacklist.map((c) => c.toLowerCase().trim()));
  if (blacklist.has(job.company.toLowerCase().trim())) {
    return { relevant: false, reason: 'company-blacklisted' };
  }

  const jobSkills = new Set(job.skillIds);
  for (const d of prefs.dealbreakerSkills) {
    if (jobSkills.has(d)) return { relevant: false, reason: 'has-dealbreaker' };
  }
  for (const m of prefs.mustHaveSkills) {
    if (!jobSkills.has(m)) return { relevant: false, reason: 'must-have-missing' };
  }

  return { relevant: true };
}
