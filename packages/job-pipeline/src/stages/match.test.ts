import { describe, expect, it } from 'vitest';
import {
  computeCompFit,
  computeGeoFit,
  computeMatch,
  computeMatchResult,
  timezoneOverlapHours,
} from './match';

describe('computeGeoFit', () => {
  it('scores a matching country/workplace/scope at 1', () => {
    const fit = computeGeoFit({
      job: { country: 'DE', workplaceType: 'remote', remoteScope: 'remote_eu' },
      profile: { countries: ['DE'], workplaceTypes: ['remote'], remoteScopes: ['remote_eu'] },
    });
    expect(fit).toBe(1);
  });

  it('mismatched values score 0 and unknown values score 0.5', () => {
    expect(
      computeGeoFit({ job: { country: 'US' }, profile: { countries: ['DE'] } }),
    ).toBe(0);
    expect(
      computeGeoFit({ job: { country: null }, profile: { countries: ['DE'] } }),
    ).toBe(0.5);
  });

  it('ignores unconstrained axes and returns null when nothing is constrained', () => {
    expect(computeGeoFit({ job: { country: 'US' }, profile: {} })).toBeNull();
    const fit = computeGeoFit({
      job: { country: 'DE', workplaceType: 'onsite' },
      profile: { countries: ['DE'] },
    });
    expect(fit).toBe(1); // workplace axis not constrained → not punished
  });
});

describe('computeCompFit — same-currency only', () => {
  it('returns null across different currencies', () => {
    expect(
      computeCompFit({
        job: { currency: 'EUR', min: 80_000, max: 120_000 },
        profile: { currency: 'USD', min: 100_000, max: 150_000 },
      }),
    ).toBeNull();
  });

  it('returns null when either band is missing', () => {
    expect(
      computeCompFit({ job: { currency: 'USD', min: null, max: null }, profile: { currency: 'USD', min: 1, max: 2 } }),
    ).toBeNull();
  });

  it('scores overlapping same-currency bands in (0,1]', () => {
    const fit = computeCompFit({
      job: { currency: 'USD', min: 100_000, max: 140_000 },
      profile: { currency: 'USD', min: 120_000, max: 160_000 },
    });
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThanOrEqual(1);
  });

  it('non-overlapping same-currency bands score 0', () => {
    expect(
      computeCompFit({
        job: { currency: 'USD', min: 10_000, max: 20_000 },
        profile: { currency: 'USD', min: 100_000, max: 120_000 },
      }),
    ).toBe(0);
  });
});

describe('timezoneOverlapHours — DST-correct', () => {
  it('same zone => a full 8h working-window overlap', () => {
    expect(timezoneOverlapHours('UTC', 'UTC', new Date('2026-01-15T12:00:00Z'))).toBe(8);
    expect(
      timezoneOverlapHours('America/New_York', 'America/New_York', new Date('2026-07-15T12:00:00Z')),
    ).toBe(8);
  });

  it('a DST-observing vs non-observing pair changes overlap between Jan and Jul', () => {
    // Kolkata never shifts; London shifts +1h in July. Overlap grows from 2.5h
    // (09:00-17:00 London = 09:00-17:00 UTC) to 3.5h (08:00-16:00 UTC).
    const jan = timezoneOverlapHours(
      'Asia/Kolkata',
      'Europe/London',
      new Date('2026-01-15T12:00:00Z'),
    );
    const jul = timezoneOverlapHours(
      'Asia/Kolkata',
      'Europe/London',
      new Date('2026-07-15T12:00:00Z'),
    );
    expect(jan).toBeCloseTo(2.5, 4);
    expect(jul).toBeCloseTo(3.5, 4);
    expect(jan).not.toBeCloseTo(jul, 4);
    // MUTATION SMOKE: ignore the zone offset (difference of raw hours) -> both
    // calls collapse to the same value and this fails.
  });

  it('scores the tz axis in geoFit only when BOTH zones are known', () => {
    // Same zone, only the tz axis constrained -> 8/8 = 1.
    expect(
      computeGeoFit({ job: { timezone: 'Europe/London' }, profile: { timezone: 'Europe/London' } }),
    ).toBe(1);
    // Unknown job tz leaves the axis UNCOMPUTED: the country axis alone is 1,
    // so geoFit is 1 (not diluted toward 0.5 by a fabricated tz score).
    expect(
      computeGeoFit({
        job: { country: 'DE', timezone: null },
        profile: { countries: ['DE'], timezone: 'Asia/Kolkata' },
      }),
    ).toBe(1);
    expect(
      computeGeoFit({ job: { country: 'DE' }, profile: { countries: ['DE'] } }),
    ).toBe(1);
  });

  it('normalizes the overlap by the desired hours when set, else by a workday', () => {
    // NY vs Berlin overlap ~2h year-round. Desired 8h -> 0.25.
    expect(
      computeGeoFit({
        job: { timezone: 'Europe/Berlin' },
        profile: { timezone: 'America/New_York', timezoneOverlapHours: 8 },
      }),
    ).toBeCloseTo(0.25, 4);
    // Desired 1h -> clamp(2/1) = 1.
    expect(
      computeGeoFit({
        job: { timezone: 'Europe/Berlin' },
        profile: { timezone: 'America/New_York', timezoneOverlapHours: 1 },
      }),
    ).toBe(1);
    // No desired -> 2/8 = 0.25.
    expect(
      computeGeoFit({
        job: { timezone: 'Europe/Berlin' },
        profile: { timezone: 'America/New_York' },
      }),
    ).toBeCloseTo(0.25, 4);
  });
});

describe('match output shape — geo/comp are optional', () => {
  const base = {
    jobId: 'job-1',
    required: [{ skillId: 'ts', weight: 1 }],
    nameById: new Map([['ts', 'TypeScript']]),
    stateBySkill: new Map([['ts', { proficiency: 80, recencyDays: 5 }]]),
    evidenceBySkill: new Map(),
  };

  it('omits geoFit/compFit when no geo/comp input is supplied (legacy)', () => {
    const match = computeMatchResult(base);
    expect('geoFit' in match).toBe(false);
    expect('compFit' in match).toBe(false);
    const score = computeMatch(base);
    expect('geoFit' in score).toBe(false);
    expect('compFit' in score).toBe(false);
  });

  it('includes geoFit/compFit when inputs are supplied', () => {
    const match = computeMatchResult({
      ...base,
      geo: { job: { country: 'DE' }, profile: { countries: ['DE'] } },
      comp: { job: { currency: 'EUR', min: 90_000, max: 120_000 }, profile: { currency: 'EUR', min: 100_000, max: 140_000 } },
    });
    expect(match.geoFit).toBe(1);
    expect(match.compFit).toBeGreaterThan(0);
  });

  it('still emits geoFit for a job with no extracted skills', () => {
    const match = computeMatchResult({
      ...base,
      required: [],
      geo: { job: { country: 'DE' }, profile: { countries: ['DE'] } },
    });
    expect(match.score).toBeNull();
    expect(match.geoFit).toBe(1);
  });
});
