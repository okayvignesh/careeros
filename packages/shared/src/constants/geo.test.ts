import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  REGIONS,
  WORKPLACE_TYPES,
  REMOTE_SCOPES,
  countriesOfRegion,
  countryByCode,
  countryByName,
  isCountry,
} from './geo';

describe('geo constants', () => {
  it('exposes the closed vocabularies', () => {
    expect(WORKPLACE_TYPES).toEqual(['remote', 'hybrid', 'onsite']);
    expect(REMOTE_SCOPES).toEqual(['remote_local', 'remote_regional', 'remote_global']);
    expect(REGIONS).toContain('europe');
  });

  it('isCountry accepts only known ISO alpha-2 codes', () => {
    expect(isCountry('US')).toBe(true);
    expect(isCountry('DE')).toBe(true);
    expect(isCountry('IN')).toBe(true);
    expect(isCountry('ZZ')).toBe(false);
    expect(isCountry('us')).toBe(false); // codes are stored uppercase
    expect(isCountry('')).toBe(false);
  });

  it('countriesOfRegion returns only matching countries and [] for unknown', () => {
    const europe = countriesOfRegion('europe');
    expect(europe.length).toBeGreaterThan(20);
    expect(europe.every((c) => c.region === 'europe')).toBe(true);
    expect(europe.map((c) => c.code)).toContain('DE');
    expect(countriesOfRegion('atlantis')).toEqual([]);
  });

  it('every country has a valid region + ISO currency', () => {
    for (const c of COUNTRIES) {
      expect(REGIONS).toContain(c.region);
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('resolves countries by name and common alias', () => {
    expect(countryByCode('de')?.name).toBe('Germany');
    expect(countryByName('United States')?.code).toBe('US');
    expect(countryByName('USA')?.code).toBe('US');
    expect(countryByName('UK')?.code).toBe('GB');
    expect(countryByName('Holland')?.code).toBe('NL');
    expect(countryByName('nowhere')).toBeUndefined();
  });
});
