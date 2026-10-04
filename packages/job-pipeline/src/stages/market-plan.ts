// Market-scoped ingest plan (job-targeting §6).
//
// A `MarketPlan` is the targeting profile distilled to what an adapter fetch
// needs: one target per market (country + optional city) plus the role queries
// used for discovery. `buildMarketSyncRequests` maps a plan to the exact set of
// outbound requests an adapter should issue, so "request set == market plan,
// non-target countries → zero calls" is enforceable as a unit test.

export interface MarketTarget {
  /** ISO-3166 alpha-2. Case-insensitive; adapters normalize as needed. */
  country: string;
  /** Optional city/region to narrow the market (Adzuna `where`, Firecrawl `location`). */
  location?: string;
}

export interface MarketPlan {
  targets: MarketTarget[];
  /** Role/keyword queries for discovery adapters (Firecrawl). */
  queries?: string[];
}

/** One outbound request descriptor. `country`/`location` are market-scoped. */
export interface MarketSyncRequest {
  adapterId: string;
  country?: string;
  location?: string;
}

/** Adapters that can scope a single request to one market. */
const MARKET_SCOPED = new Set(['adzuna', 'firecrawl']);

/**
 * Expand a plan into the requests an adapter should issue. Market-scoped
 * adapters get exactly one request per target; every other adapter keeps its
 * legacy single fetch (the plan still influences read-time geo signals).
 */
export function buildMarketSyncRequests(
  adapterId: string,
  plan: MarketPlan,
): MarketSyncRequest[] {
  if (plan.targets.length === 0 || !MARKET_SCOPED.has(adapterId)) {
    return [{ adapterId }];
  }
  return plan.targets.map((t) => {
    const req: MarketSyncRequest = {
      adapterId,
      // Adzuna lowercases its path segment; Firecrawl accepts either.
      country: t.country.toLowerCase(),
    };
    if (t.location) req.location = t.location;
    return req;
  });
}

export interface MarketProfile {
  countries?: readonly string[];
  cities?: readonly { country: string; city: string }[];
}

/**
 * Derive market targets from a targeting profile: one target per country, in
 * the order countries were listed, with the first matching city (if any) as the
 * `location` narrowing.
 */
export function marketTargetsFromProfile(profile: MarketProfile): MarketTarget[] {
  const citiesByCountry = new Map<string, string>();
  for (const { country, city } of profile.cities ?? []) {
    const key = country.trim().toLowerCase();
    if (key && city.trim() && !citiesByCountry.has(key)) citiesByCountry.set(key, city.trim());
  }

  const out: MarketTarget[] = [];
  const seen = new Set<string>();
  for (const rawCountry of profile.countries ?? []) {
    const country = rawCountry.trim();
    const key = country.toLowerCase();
    if (!country || seen.has(key)) continue;
    seen.add(key);
    const t: MarketTarget = { country };
    const city = citiesByCountry.get(key);
    if (city) t.location = city;
    out.push(t);
  }
  return out;
}
