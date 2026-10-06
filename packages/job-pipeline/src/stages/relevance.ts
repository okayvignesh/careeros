// Relevance filter — pure pipeline stage. Moved out of the inline filter
// previously buried in JobsService.list so every source funnels through the
// package (AGENTS.md §12: … verify → relevance filter → match score → land).
//
// Evaluated in the same order as the old inline filter so `job_reject_log`
// reason codes and the listing's reject counters stay byte-identical:
// stale → remote-only → company-blacklisted → has-dealbreaker → must-have-missing.
import { freshness } from './freshness';
import { authorizationFor, normalizeSponsorship } from './eligibility';

export interface RelevancePrefs {
  remoteOnly: boolean;
  mustHaveSkills: readonly string[];
  dealbreakerSkills: readonly string[];
  companyBlacklist: readonly string[];
  // --- P1 job-targeting (all optional so legacy callers are unchanged) ---
  workplaceTypes?: readonly string[];
  countries?: readonly string[];
  cities?: readonly { country: string; city: string }[];
  homeCountry?: string | null;
  workAuthorizations?: readonly string[];
  citizenships?: readonly string[];
  relocationWilling?: boolean;
  sponsorshipCountries?: readonly string[];
  currency?: string;
  compMin?: number | null;
  compMax?: number | null;
}

export interface RelevanceJob {
  company: string;
  remote: boolean;
  skillIds: readonly string[];
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
  // --- P1 geo signals (optional; absent → no geo soft signals) ---
  country?: string | null;
  region?: string | null;
  workplaceType?: string | null;
  remoteScope?: string | null;
  sponsorshipSignal?: string | null;
  compCurrency?: string | null;
}

export type RelevanceSignalType =
  | 'workplace_mismatch'
  | 'location_mismatch'
  | 'relocation_required'
  | 'authorization_required'
  | 'sponsorship_unclear'
  | 'comp_uncomparable';

export interface RelevanceSignal {
  type: RelevanceSignalType;
  detail: string;
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
  /**
   * Soft, non-hiding signals for discovery ranking. Omitted entirely when no
   * geo/targeting input is supplied, so legacy callers keep byte-identical
   * output (frozen backward-compat contract).
   */
  signals?: RelevanceSignal[];
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

  const signals = softSignals(job, prefs);
  return signals.length > 0 ? { relevant: true, signals } : { relevant: true };
}

/**
 * Discovery soft signals. These NEVER hide a job — they only annotate it so
 * the list can rank and explain. `remoteOnly` stays the hard reject; workplace
 * and location signals are suppressed when it is on (the hard filter already
 * owns that axis).
 */
function softSignals(job: RelevanceJob, prefs: RelevancePrefs): RelevanceSignal[] {
  const signals: RelevanceSignal[] = [];
  const country = job.country ?? null;
  const sponsorship = normalizeSponsorship(job.sponsorshipSignal);

  if (!prefs.remoteOnly) {
    if (
      prefs.workplaceTypes &&
      prefs.workplaceTypes.length > 0 &&
      job.workplaceType &&
      !prefs.workplaceTypes.includes(job.workplaceType)
    ) {
      signals.push({
        type: 'workplace_mismatch',
        detail: `Listing is ${job.workplaceType}; you target ${prefs.workplaceTypes.join('/')}.`,
      });
    }
    if (
      prefs.countries &&
      prefs.countries.length > 0 &&
      country &&
      !prefs.countries.includes(country)
    ) {
      signals.push({
        type: 'location_mismatch',
        detail: `Listing is in ${country}; you target ${prefs.countries.join('/')}.`,
      });
    }
    if (
      country &&
      prefs.homeCountry &&
      country !== prefs.homeCountry &&
      !job.remote &&
      prefs.relocationWilling === false
    ) {
      signals.push({
        type: 'relocation_required',
        detail: `Onsite role in ${country}; relocation not enabled.`,
      });
    }
  }

  const profile = {
    homeCountry: prefs.homeCountry ?? null,
    citizenships: prefs.citizenships ?? [],
    workAuthorizations: prefs.workAuthorizations ?? [],
  };
  if (country && authorizationFor(profile, country) === 'required' && sponsorship !== 'likely') {
    signals.push({
      type: 'authorization_required',
      detail: `Work authorization in ${country} is required and sponsorship isn't stated as likely.`,
    });
    if (sponsorship === 'unclear') {
      signals.push({
        type: 'sponsorship_unclear',
        detail: `No sponsorship signal for a role in ${country}.`,
      });
    }
  }

  if (
    prefs.currency &&
    job.compCurrency &&
    job.compCurrency.toUpperCase() !== prefs.currency.toUpperCase()
  ) {
    signals.push({
      type: 'comp_uncomparable',
      detail: `Comp in ${job.compCurrency}; your band is ${prefs.currency} (no cross-currency compare).`,
    });
  }

  return signals;
}
