import { describe, expect, it } from 'vitest';
import { buildMarketSyncRequests, marketTargetsFromProfile } from './market-plan';

describe('buildMarketSyncRequests', () => {
  it('maps a market-scoped adapter to exactly one request per target', () => {
    const plan = {
      targets: [
        { country: 'DE' },
        { country: 'US', location: 'Austin' },
      ],
    };
    expect(buildMarketSyncRequests('adzuna', plan)).toEqual([
      { adapterId: 'adzuna', country: 'de' },
      { adapterId: 'adzuna', country: 'us', location: 'Austin' },
    ]);
    expect(buildMarketSyncRequests('firecrawl', plan)).toEqual([
      { adapterId: 'firecrawl', country: 'de' },
      { adapterId: 'firecrawl', country: 'us', location: 'Austin' },
    ]);
  });

  it('collapses to a single unscoped request for empty plans / unscoped adapters', () => {
    expect(buildMarketSyncRequests('adzuna', { targets: [] })).toEqual([{ adapterId: 'adzuna' }]);
    expect(
      buildMarketSyncRequests('remotive', { targets: [{ country: 'DE' }] }),
    ).toEqual([{ adapterId: 'remotive' }]);
  });

  it('never emits a request for a non-target country', () => {
    const requests = buildMarketSyncRequests('adzuna', { targets: [{ country: 'DE' }] });
    const countries = requests.map((r) => r.country);
    expect(countries).toEqual(['de']);
    expect(countries).not.toContain('gb');
  });
});

describe('marketTargetsFromProfile', () => {
  it('produces one target per country and folds a city into its location', () => {
    const targets = marketTargetsFromProfile({
      countries: ['DE', 'US'],
      cities: [{ country: 'US', city: 'Austin' }],
    });
    expect(targets).toEqual([{ country: 'DE' }, { country: 'US', location: 'Austin' }]);
  });

  it('dedupes repeated countries and ignores empty entries', () => {
    const targets = marketTargetsFromProfile({ countries: ['DE', 'DE', ''] });
    expect(targets).toEqual([{ country: 'DE' }]);
  });
});
