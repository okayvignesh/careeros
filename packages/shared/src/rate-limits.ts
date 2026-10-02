/**
 * Per-provider rate-limit declarations. AGENTS.md §6 requires every adapter to
 * declare its upstream provider's limits here so BullMQ workers and scheduled
 * crawlers can size `limiter: { max, duration }` without each adapter inventing
 * its own numbers.
 *
 * These are ceilings, not a guarantee. Real enforcement lives in the worker
 * queue (per-host pacing) plus `@careeros/shared` retry, which honors `429`
 * `Retry-After`. When a provider publishes no number we record a deliberately
 * conservative courtesy ceiling and say so in `note`.
 */

export interface ProviderRateLimit {
  /** Sustained request ceiling per minute, where the provider publishes one. */
  callsPerMinute?: number;
  /** Hourly ceiling, where published. */
  callsPerHour?: number;
  /** Daily ceiling, where published (Adzuna free tier is per day). */
  callsPerDay?: number;
  /** Free-text qualifier: plan, endpoint, or quota unit the numbers apply to. */
  note?: string;
}

export const RATE_LIMITS = {
  'github': { callsPerHour: 5000, note: 'Authenticated REST API. 60/hr unauthenticated.' },
  'deepseek': { note: 'Provider-declared per account; tracked from packages/ai pricing sheet.' },
  'ashby': { callsPerMinute: 60, note: 'Public posting API: not formally limited; polite ceiling.' },
  'greenhouse': { callsPerMinute: 60, note: 'Public boards API: soft ~10 req/s per token.' },
  'adzuna': { callsPerMinute: 1, callsPerDay: 25, note: 'Free tier: ~25 requests/day/app.' },
  'arbeitnow': { callsPerMinute: 30, note: 'Public JSON feed: no published limit; best-effort.' },
  'remotive': { callsPerMinute: 4, callsPerHour: 250, note: 'Public API: no published limit; best-effort.' },
  'firecrawl': {
    callsPerMinute: 10,
    callsPerDay: 1000,
    note: 'Free plan: 10 req/min on /scrape,/map,/search; 2 req/min on /crawl. Paid plans higher.',
  },
  'workday': {
    callsPerMinute: 20,
    note: 'Public CXS endpoint: no published limit; conservative courtesy ceiling per host.',
  },
  'lever': {
    callsPerMinute: 60,
    note: 'Public Postings API (v0): read endpoints rate-limited per IP; polite ceiling.',
  },
  'smartrecruiters': {
    callsPerMinute: 60,
    note: 'Public Posting API: no published limit; conservative courtesy ceiling per company.',
  },
  'workable': {
    callsPerMinute: 10,
    note: 'Public jobs widget: aggressive per-IP heuristic (soft-bans ~100 requests); keep low.',
  },
  'icims': {
    callsPerMinute: 30,
    callsPerDay: 10_000,
    note: 'Partner Job Portal API (Basic auth); Search API is cache-backed, not real-time.',
  },
  'successfactors': {
    callsPerMinute: 60,
    note: 'Tenant OData v2 API (Basic auth); per-tenant fair-use, no published number.',
  },
  'slack': { callsPerMinute: 60, note: 'Web API tier 3: 1 req/sec per channel.' },
  'gmail': { note: '250 quota units/sec/user; units-not-requests, so no request ceiling.' },
} as const satisfies Record<string, ProviderRateLimit>;

export type RateLimitProvider = keyof typeof RATE_LIMITS;

/** Look up one provider's declared limits (undefined for unknown providers). */
export function rateLimitFor(provider: string): ProviderRateLimit | undefined {
  return (RATE_LIMITS as Record<string, ProviderRateLimit>)[provider];
}
