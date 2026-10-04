import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { COUNTRIES } from '@careeros/shared';
import { regionToTemplate } from '@careeros/resume-render';
import {
  buildResumeContact,
  resolveTargetingContext,
  EMPTY_TARGETING_PROFILE,
  type TargetingProfile,
} from './targeting-context';

/**
 * P2b region-aware tailoring, deterministic and code-only.
 *
 * The full-country-table test proves `regionToTemplate` is total and
 * deterministic over `@careeros/shared`'s ISO-3166 table — no region or country
 * can silently produce a missing template.
 */
describe('region → template over the full country table', () => {
  it('every country maps deterministically to a registered template', () => {
    const mapping = COUNTRIES.map((c) => [c.code, regionToTemplate(c.region)] as const);
    // Deterministic: a second pass yields the identical mapping.
    expect(new Map(mapping)).toEqual(new Map(COUNTRIES.map((c) => [c.code, regionToTemplate(c.region)])));
    // Total: no undefined/unknown template.
    for (const [, template] of mapping) {
      expect(['classic', 'international']).toContain(template);
    }
  });

  it('snapshot: North America → classic, every other region → international', () => {
    const classic = COUNTRIES.filter((c) => regionToTemplate(c.region) === 'classic');
    const international = COUNTRIES.filter((c) => regionToTemplate(c.region) === 'international');
    // North America is the only LETTER-baseline region.
    expect(classic.every((c) => c.region === 'north_america')).toBe(true);
    expect(international.every((c) => c.region !== 'north_america')).toBe(true);
    expect(classic).toHaveLength(COUNTRIES.filter((c) => c.region === 'north_america').length);
    expect(classic.length + international.length).toBe(COUNTRIES.length);
    // Spot-check the load-bearing countries from the spec.
    expect(regionToTemplate('north_america')).toBe('classic');
    expect(regionToTemplate('europe')).toBe('international');
  });
});

describe('resolveTargetingContext', () => {
  const profile: TargetingProfile = {
    targetRoles: ['Staff Site Reliability Engineer'],
    countries: ['DE'],
    homeCountry: 'IN',
    seniority: ['senior'],
    relocationWilling: true,
    relocationCountries: ['DE', 'NL'],
  };

  it('uses the profile target-role override instead of the raw job title', () => {
    const ctx = resolveTargetingContext(profile, { title: 'Backend Engineer', country: 'DE' });
    expect(ctx.targetRole).toBe('Staff Site Reliability Engineer');
    expect(ctx.region).toBe('europe');
    expect(ctx.targetMarket).toBe('Germany');
    expect(ctx.templateId).toBe('international');
  });

  it('falls back to the job for role/region/market when the profile is empty', () => {
    const ctx = resolveTargetingContext(EMPTY_TARGETING_PROFILE, {
      title: 'Platform Engineer',
      country: 'US',
    });
    expect(ctx.targetRole).toBe('Platform Engineer');
    expect(ctx.region).toBe('north_america');
    expect(ctx.targetMarket).toBe('United States');
    expect(ctx.templateId).toBe('classic');
  });

  it('defaults to classic and a neutral market when nothing is known', () => {
    const ctx = resolveTargetingContext(EMPTY_TARGETING_PROFILE, {
      title: 'Remote Engineer',
      country: null,
    });
    expect(ctx.region).toBeNull();
    expect(ctx.templateId).toBe('classic');
    expect(ctx.targetMarket).toBe('Global / remote');
  });

  it('a valid explicit template override wins over the region mapping', () => {
    const ctx = resolveTargetingContext(
      profile,
      { title: 'Backend Engineer', country: 'DE' },
      { template: 'dense-tech' },
    );
    expect(ctx.templateId).toBe('dense-tech');
  });

  it('rejects an unknown explicit template override (no silent fallback)', () => {
    expect(() =>
      resolveTargetingContext(profile, { title: 'x', country: 'DE' }, { template: 'nope' }),
    ).toThrow(BadRequestException);
  });
});

describe('buildResumeContact (verified facts only)', () => {
  it('copies location/headline/identity verbatim from matching facts', () => {
    const contact = buildResumeContact([
      { kind: 'location', content: { text: 'Berlin, Germany' } },
      { kind: 'headline', content: { text: 'Staff SRE' } },
      { kind: 'contact', content: { name: 'Jane Doe', email: 'jane@example.com' } },
    ]);
    expect(contact).toEqual({
      location: 'Berlin, Germany',
      headline: 'Staff SRE',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('returns undefined when no fact supplies a contact field (never fabricates)', () => {
    expect(
      buildResumeContact([{ kind: 'employment', content: { title: 'SRE' } }]),
    ).toBeUndefined();
    expect(buildResumeContact([])).toBeUndefined();
  });

  it('does not read unrelated or malformed fact content', () => {
    const contact = buildResumeContact([
      { kind: 'location', content: { text: 42 } },
      { kind: 'project', content: { location: 'Invented City' } },
      { kind: 'location', content: null },
    ]);
    expect(contact).toBeUndefined();
  });
});
