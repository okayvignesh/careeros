// P2 job-targeting §8: one pure definition of "is this job in the user's
// target market?" shared by the demand pool, the market brief, the snapshot
// filter and the learning-priority orchestrator (via MarketDemandService).
//
// The scope axes are the ones a targeting profile actually expresses:
//   - countries      (ISO-3166 alpha-2) — a job with a known country must be in
//                      the list; a job with UNKNOWN country may still qualify
//                      when its known region maps to a target country's region.
//   - workplaceTypes (remote | hybrid | onsite)
//   - remoteScopes   (remote_local | remote_regional | remote_global), enforced
//                      only for remote roles.
//
// Null geo is never guessed. When an axis is constrained and the job's value is
// unknown, the job is excluded and the caller gets a reason string
// (`*_unknown`); a known-but-different value yields `*_mismatch`. An empty
// scope constrains nothing, so every job is in scope (graceful degradation).
import { countryByCode, type Region } from '@careeros/shared';

export interface MarketScope {
  countries: readonly string[];
  regions: readonly Region[];
  workplaceTypes: readonly string[];
  remoteScopes: readonly string[];
}

export interface ScopedJobGeo {
  country?: string | null;
  region?: string | null;
  workplaceType?: string | null;
  remoteScope?: string | null;
  remote?: boolean | null;
}

export type GeoScopeReason =
  | 'country_mismatch'
  | 'country_unknown'
  | 'workplace_mismatch'
  | 'workplace_unknown'
  | 'remote_scope_mismatch'
  | 'remote_scope_unknown';

export interface GeoScopeVerdict {
  inScope: boolean;
  reason?: GeoScopeReason;
}

export const EMPTY_MARKET_SCOPE: MarketScope = {
  countries: [],
  regions: [],
  workplaceTypes: [],
  remoteScopes: [],
};

/** Coarse regions covered by a set of target countries (deduped, stable order). */
export function regionsForCountries(countries: readonly string[]): Region[] {
  const out = new Set<Region>();
  for (const code of countries) {
    const region = countryByCode(code)?.region;
    if (region) out.add(region);
  }
  return [...out].sort();
}

/** Build a normalized scope from the profile-shaped axes. */
export function marketScope(
  countries: readonly string[] = [],
  workplaceTypes: readonly string[] = [],
  remoteScopes: readonly string[] = [],
): MarketScope {
  const normalized = [...new Set(countries.map((c) => c.toUpperCase()).filter(Boolean))];
  return {
    countries: normalized,
    regions: regionsForCountries(normalized),
    workplaceTypes: [...new Set(workplaceTypes)],
    remoteScopes: [...new Set(remoteScopes)],
  };
}

/** True when the scope constrains nothing (absent market scope). */
export function isEmptyMarketScope(scope: MarketScope): boolean {
  return (
    scope.countries.length === 0 &&
    scope.regions.length === 0 &&
    scope.workplaceTypes.length === 0 &&
    scope.remoteScopes.length === 0
  );
}

/**
 * Pure market-scope verdict. Deterministic and total — never throws. Returns a
 * reason whenever it excludes, so callers can log/surface *why* without
 * inventing a match.
 */
export function jobMatchesMarketScope(
  scope: MarketScope,
  job: ScopedJobGeo,
): GeoScopeVerdict {
  if (scope.countries.length > 0 || scope.regions.length > 0) {
    const country = job.country ? job.country.toUpperCase() : null;
    const region = job.region ?? null;
    if (country !== null && scope.countries.includes(country)) {
      // explicit country hit — continue to the other axes
    } else if (country !== null) {
      return { inScope: false, reason: 'country_mismatch' };
    } else if (region !== null && scope.regions.includes(region as Region)) {
      // country unknown, but the region is one of the target countries'
      // regions — count it (unknown is not a mismatch).
    } else if (region !== null) {
      return { inScope: false, reason: 'country_mismatch' };
    } else {
      return { inScope: false, reason: 'country_unknown' };
    }
  }

  if (scope.workplaceTypes.length > 0) {
    const workplaceType = job.workplaceType ?? null;
    if (workplaceType === null) {
      return { inScope: false, reason: 'workplace_unknown' };
    }
    if (!scope.workplaceTypes.includes(workplaceType)) {
      return { inScope: false, reason: 'workplace_mismatch' };
    }
  }

  if (scope.remoteScopes.length > 0) {
    const isRemote = job.workplaceType === 'remote' || job.remote === true;
    if (isRemote) {
      const remoteScope = job.remoteScope ?? null;
      if (remoteScope === null) {
        return { inScope: false, reason: 'remote_scope_unknown' };
      }
      if (!scope.remoteScopes.includes(remoteScope)) {
        return { inScope: false, reason: 'remote_scope_mismatch' };
      }
    }
  }

  return { inScope: true };
}
