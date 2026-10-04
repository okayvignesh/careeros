import { describe, expect, it } from 'vitest';
import {
  authorizationFor,
  isEligibleToApply,
  normalizeSponsorship,
  type EligibilityJob,
  type EligibilityProfile,
} from './eligibility';

const PROFILE_IN: EligibilityProfile = { homeCountry: 'IN', citizenships: ['IN'], workAuthorizations: [] };

describe('authorizationFor', () => {
  it('home country / citizenship / explicit authorization are ok', () => {
    expect(authorizationFor(PROFILE_IN, 'IN')).toBe('ok');
    expect(authorizationFor({ workAuthorizations: ['DE'] }, 'DE')).toBe('ok');
    expect(authorizationFor({ citizenships: ['CA'] }, 'CA')).toBe('ok');
  });

  it('unknown or unlisted country is required', () => {
    expect(authorizationFor(PROFILE_IN, 'US')).toBe('required');
    expect(authorizationFor(PROFILE_IN, null)).toBe('required');
  });
});

describe('isEligibleToApply — two-track truth table', () => {
  const states = ['verified', 'discovered'] as const;
  const sponsorships = ['likely', 'unclear', 'none'] as const;

  const expected = (state: string, authorization: 'ok' | 'required', sponsorship: string) =>
    state === 'verified' && (authorization === 'ok' || sponsorship === 'likely');

  for (const state of states) {
    for (const sponsorship of sponsorships) {
      for (const country of ['IN', 'US'] as const) {
        const authorization: 'ok' | 'required' = country === 'IN' ? 'ok' : 'required';
        it(`state=${state} auth=${authorization} sponsorship=${sponsorship}`, () => {
          const job: EligibilityJob = { state, country, sponsorshipSignal: sponsorship };
          const result = isEligibleToApply(PROFILE_IN, job);
          expect(result.eligible).toBe(expected(state, authorization, sponsorship));
          expect(result.authorization).toBe(authorization);
          if (!result.eligible) expect(result.reason).not.toBe('eligible');
        });
      }
    }
  }

  it('named truth-table rows from the spec', () => {
    // unclear + required = ineligible
    expect(
      isEligibleToApply(PROFILE_IN, { state: 'verified', country: 'US', sponsorshipSignal: 'unclear' })
        .eligible,
    ).toBe(false);
    // likely + not verified = ineligible
    expect(
      isEligibleToApply(PROFILE_IN, { state: 'discovered', country: 'US', sponsorshipSignal: 'likely' })
        .eligible,
    ).toBe(false);
    // none + required = ineligible
    expect(
      isEligibleToApply(PROFILE_IN, { state: 'verified', country: 'US', sponsorshipSignal: 'none' })
        .eligible,
    ).toBe(false);
    // likely + verified + required auth = eligible (sponsorship track)
    expect(
      isEligibleToApply(PROFILE_IN, { state: 'verified', country: 'US', sponsorshipSignal: 'likely' })
        .eligible,
    ).toBe(true);
    // ok auth + verified, no signal = eligible (authorization track)
    expect(
      isEligibleToApply(PROFILE_IN, { state: 'verified', country: 'IN', sponsorshipSignal: 'unclear' })
        .eligible,
    ).toBe(true);
  });

  it('missing/null geo is required; missing signal is unclear', () => {
    const result = isEligibleToApply(PROFILE_IN, { state: 'verified', country: null, sponsorshipSignal: null });
    expect(result.authorization).toBe('required');
    expect(result.sponsorship).toBe('unclear');
    expect(result.eligible).toBe(false);
    expect(normalizeSponsorship(undefined)).toBe('unclear');
  });
});
