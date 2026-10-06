// Two-track apply eligibility — the single gate for "Apply" and
// "Recommended for you" (job-targeting §7).
//
// A job is eligible when it is VERIFIED and EITHER the candidate is already
// authorized to work in the job's country OR the employer likely sponsors.
// Eligibility is necessary but not sufficient: the approval queue + audit log
// still gate every outbound submission (AGENTS §3.3).
//
// Missing or unparsed geo is treated as `authorization: required`; a missing
// sponsorship signal is treated as `unclear`. Neither is ever upgraded by
// assumption.
import type { SponsorshipSignal } from '@careeros/shared';

export interface EligibilityProfile {
  /** ISO-3166 alpha-2 of the candidate's home country, if set. */
  homeCountry?: string | null;
  /** ISO-3166 alpha-2 countries the candidate holds citizenship in. */
  citizenships?: readonly string[];
  /** ISO-3166 alpha-2 countries the candidate may already work in. */
  workAuthorizations?: readonly string[];
  /** Countries where sponsorship is acceptable to the candidate. */
  sponsorshipCountries?: readonly string[];
}

export interface EligibilityJob {
  /** Pipeline state, lowercase (`verified` passes the state track). */
  state: string;
  country?: string | null;
  sponsorshipSignal?: SponsorshipSignal | string | null;
}

export type AuthorizationTrack = 'ok' | 'required';
export type EligibilityReason =
  | 'eligible'
  | 'not_verified'
  | 'authorization_required'
  | 'sponsorship_unclear';

export interface EligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  authorization: AuthorizationTrack;
  sponsorship: SponsorshipSignal;
}

/** Normalize a raw signal (DB string / missing) to the closed vocabulary. */
export function normalizeSponsorship(value: string | null | undefined): SponsorshipSignal {
  return value === 'likely' || value === 'none' ? value : 'unclear';
}

/** Whether the candidate can already work in `country` without sponsorship. */
export function authorizationFor(
  profile: EligibilityProfile,
  country: string | null | undefined,
): AuthorizationTrack {
  if (!country) return 'required';
  if (profile.homeCountry && profile.homeCountry === country) return 'ok';
  if ((profile.citizenships ?? []).includes(country)) return 'ok';
  if ((profile.workAuthorizations ?? []).includes(country)) return 'ok';
  return 'required';
}

/**
 * The two-track gate. `state === 'verified'` AND (authorization ok OR
 * sponsorship likely). Returns the reason so callers can log the decision and
 * the UI can explain "why not eligible".
 */
export function isEligibleToApply(
  profile: EligibilityProfile,
  job: EligibilityJob,
): EligibilityResult {
  const authorization = authorizationFor(profile, job.country);
  const sponsorship = normalizeSponsorship(job.sponsorshipSignal);
  const verified = job.state === 'verified';

  if (!verified) {
    return { eligible: false, reason: 'not_verified', authorization, sponsorship };
  }
  if (authorization === 'ok' || sponsorship === 'likely') {
    return { eligible: true, reason: 'eligible', authorization, sponsorship };
  }
  return {
    eligible: false,
    reason: sponsorship === 'none' ? 'authorization_required' : 'sponsorship_unclear',
    authorization,
    sponsorship,
  };
}
