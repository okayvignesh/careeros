import { describe, expect, it } from 'vitest';
import {
  EMPTY_MARKET_SCOPE,
  isEmptyMarketScope,
  jobMatchesMarketScope,
  marketScope,
  regionsForCountries,
} from './market-scope';

describe('marketScope', () => {
  it('uppercases + dedupes countries and derives their regions', () => {
    const scope = marketScope(['us', 'DE', 'US'], ['remote'], ['remote_global']);
    expect(scope.countries).toEqual(['US', 'DE']);
    expect([...scope.regions].sort()).toEqual(['europe', 'north_america']);
    expect(scope.workplaceTypes).toEqual(['remote']);
    expect(scope.remoteScopes).toEqual(['remote_global']);
  });

  it('regionsForCountries maps known countries and ignores unknown ones', () => {
    expect(regionsForCountries(['US', 'DE', 'ZZ']).sort()).toEqual([
      'europe',
      'north_america',
    ]);
  });

  it('an absent profile is the empty scope', () => {
    expect(marketScope([], [], [])).toEqual(EMPTY_MARKET_SCOPE);
    expect(isEmptyMarketScope(EMPTY_MARKET_SCOPE)).toBe(true);
    expect(isEmptyMarketScope(marketScope(['DE']))).toBe(false);
  });
});

describe('jobMatchesMarketScope', () => {
  it('an empty scope counts every job, including null geo', () => {
    expect(jobMatchesMarketScope(EMPTY_MARKET_SCOPE, {})).toEqual({ inScope: true });
    expect(
      jobMatchesMarketScope(EMPTY_MARKET_SCOPE, {
        country: 'DE',
        workplaceType: 'remote',
        remoteScope: null,
      }),
    ).toEqual({ inScope: true });
  });

  it('country: known match passes, known mismatch excludes, unknown excludes with a reason', () => {
    const scope = marketScope(['DE']);
    expect(jobMatchesMarketScope(scope, { country: 'DE' }).inScope).toBe(true);
    expect(jobMatchesMarketScope(scope, { country: 'US' })).toEqual({
      inScope: false,
      reason: 'country_mismatch',
    });
    // null country AND null region -> explicitly unknown, never counted.
    expect(jobMatchesMarketScope(scope, { country: null, region: null })).toEqual({
      inScope: false,
      reason: 'country_unknown',
    });
  });

  it('country: unknown country but targeted region is counted; non-target region is not', () => {
    const scope = marketScope(['DE']);
    expect(jobMatchesMarketScope(scope, { country: null, region: 'europe' }).inScope).toBe(true);
    expect(jobMatchesMarketScope(scope, { country: null, region: 'north_america' })).toEqual({
      inScope: false,
      reason: 'country_mismatch',
    });
  });

  it('workplace: unknown excludes with a reason, mismatch excludes, match passes', () => {
    const scope = marketScope([], ['hybrid'], []);
    expect(jobMatchesMarketScope(scope, { workplaceType: 'hybrid' }).inScope).toBe(true);
    expect(jobMatchesMarketScope(scope, { workplaceType: 'onsite' })).toEqual({
      inScope: false,
      reason: 'workplace_mismatch',
    });
    expect(jobMatchesMarketScope(scope, { workplaceType: null })).toEqual({
      inScope: false,
      reason: 'workplace_unknown',
    });
  });

  it('remote scope is enforced only for remote roles; unknown remote scope excludes', () => {
    const scope = marketScope([], [], ['remote_global']);
    expect(
      jobMatchesMarketScope(scope, { workplaceType: 'remote', remoteScope: 'remote_global' }).inScope,
    ).toBe(true);
    expect(
      jobMatchesMarketScope(scope, { workplaceType: 'remote', remoteScope: 'remote_local' }),
    ).toEqual({ inScope: false, reason: 'remote_scope_mismatch' });
    expect(
      jobMatchesMarketScope(scope, { workplaceType: 'remote', remoteScope: null }),
    ).toEqual({ inScope: false, reason: 'remote_scope_unknown' });
    // Not remote -> the remote-scope axis does not apply.
    expect(
      jobMatchesMarketScope(scope, { workplaceType: 'onsite', remoteScope: null }).inScope,
    ).toBe(true);
  });

  it('combines axes: a country match can still fail a workplace axis', () => {
    const scope = marketScope(['DE'], ['hybrid'], []);
    expect(
      jobMatchesMarketScope(scope, { country: 'DE', workplaceType: 'onsite' }),
    ).toEqual({ inScope: false, reason: 'workplace_mismatch' });
  });
});
