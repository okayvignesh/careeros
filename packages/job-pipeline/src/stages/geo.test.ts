import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseLocation, sponsorshipSignal } from './geo';

describe('parseLocation — geo fixtures', () => {
  it('ambiguous city without country context is unparsed, never guessed', () => {
    // MUTATION SMOKE: default the city's first candidate country → `country`
    // becomes GB and `unparsed` disappears; both assertions fail.
    const london = parseLocation('London');
    expect(london.country).toBeUndefined();
    expect(london.city).toBe('london');
    expect(london.unparsed).toBe(true);

    const paris = parseLocation('Paris');
    expect(paris.country).toBeUndefined();
    expect(paris.unparsed).toBe(true);
  });

  it('resolves country from a City, Country format', () => {
    expect(parseLocation('London, UK')).toMatchObject({ country: 'GB', city: 'london' });
    expect(parseLocation('Paris, France')).toMatchObject({ country: 'FR', city: 'paris' });
    expect(parseLocation('Bengaluru, India')).toMatchObject({ country: 'IN', city: 'bengaluru' });
    expect(parseLocation('San Francisco, CA, US')).toMatchObject({ country: 'US' });
  });

  it('resolves an unambiguous city from its single country', () => {
    // Bengaluru only exists in India in the gazetteer → safe to resolve.
    expect(parseLocation('Bengaluru')).toMatchObject({ country: 'IN', city: 'bengaluru' });
    expect(parseLocation('Tokyo')).toMatchObject({ country: 'JP' });
  });

  it('recovers a country code regardless of segment case', () => {
    // Market-scoped sources hand us a lowercased ISO code.
    expect(parseLocation('de')).toMatchObject({ country: 'DE' });
    expect(parseLocation('Berlin, de')).toMatchObject({ country: 'DE', city: 'berlin' });
    // Whole-word matching stays case-sensitive: "in" is a preposition, not India.
    expect(parseLocation('Hybrid in Berlin')).toMatchObject({ country: 'DE' });
  });

  it('parses workplace + remote scope independently of geography', () => {
    expect(parseLocation('Remote - US')).toMatchObject({
      workplaceType: 'remote',
      country: 'US',
      remoteScope: 'remote_local',
    });
    expect(parseLocation('Remote (worldwide)')).toMatchObject({
      workplaceType: 'remote',
      remoteScope: 'remote_global',
    });
    expect(parseLocation('Hybrid in Berlin')).toMatchObject({
      workplaceType: 'hybrid',
      country: 'DE',
    });
    expect(parseLocation('Onsite, Dubai, UAE')).toMatchObject({
      workplaceType: 'onsite',
      country: 'AE',
    });
  });

  it('keeps workplace tokens even when the city is unknown', () => {
    const out = parseLocation('Remote, Xyzzyville');
    expect(out.workplaceType).toBe('remote');
    expect(out.unparsed).toBe(true);
  });

  it('returns {} for empty input and unparsed for unknown non-empty input', () => {
    expect(parseLocation('')).toEqual({});
    expect(parseLocation(null)).toEqual({});
    expect(parseLocation(undefined)).toEqual({});
    expect(parseLocation('   ')).toEqual({});
    expect(parseLocation('Somewhereville')).toEqual({ unparsed: true });
  });

  it('never throws on arbitrary input', () => {
    // Domain is exactly the declared input type.
    const input = fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(input, (value) => {
        expect(() => parseLocation(value)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});

describe('sponsorshipSignal — fixtures', () => {
  const cases: Array<{
    name: string;
    text: string;
    value: 'likely' | 'unclear' | 'none';
  }> = [
    { name: 'explicit available', text: 'Visa sponsorship is available for this role.', value: 'likely' },
    { name: 'we sponsor', text: 'We sponsor work visas for exceptional candidates.', value: 'likely' },
    { name: 'willing to sponsor', text: 'We are willing to sponsor the right candidate.', value: 'likely' },
    { name: 'relocation + sponsorship', text: 'Relocation and visa sponsorship provided.', value: 'likely' },
    { name: 'no sponsorship', text: 'No sponsorship is available.', value: 'none' },
    { name: 'we do not sponsor', text: 'We do not sponsor visas at this time.', value: 'none' },
    { name: 'must be authorized', text: 'Applicants must be legally authorized to work.', value: 'none' },
    { name: 'unable to sponsor', text: 'Unfortunately we are unable to sponsor candidates.', value: 'none' },
    { name: 'silence', text: 'Build great software with a great team.', value: 'unclear' },
    { name: 'empty', text: '', value: 'unclear' },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.value}`, () => {
      const result = sponsorshipSignal(c.text);
      expect(result.value).toBe(c.value);
      if (c.value !== 'unclear') expect(result.matched.length).toBeGreaterThan(0);
    });
  }

  it('negation dominates a positive phrase in the same description', () => {
    const result = sponsorshipSignal(
      'We provide visa sponsorship for some roles, but we do not sponsor for this position.',
    );
    expect(result.value).toBe('none');
  });

  it('property: confidence > 0 implies matched is non-empty', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = sponsorshipSignal(text);
        if (result.confidence > 0) expect(result.matched.length).toBeGreaterThan(0);
        if (result.value === 'unclear') expect(result.confidence).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it('never throws on arbitrary input', () => {
    const input = fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(input, (value) => {
        expect(() => sponsorshipSignal(value)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
