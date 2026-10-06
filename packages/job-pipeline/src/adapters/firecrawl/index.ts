import { createHash } from 'node:crypto';
import { RATE_LIMITS } from '@careeros/shared';
import type { AssertPublicUrlOptions } from '@careeros/shared/net';
import {
  createFirecrawlClient,
  FirecrawlConfigError,
  type FirecrawlClientOptions,
  type FirecrawlScrapeData,
  type FirecrawlScrapeOptions,
  type FirecrawlScrapeRequest,
  type FirecrawlScrapeResponse,
  type FirecrawlSearchRequest,
  type FirecrawlSearchResponse,
  type FirecrawlSearchResult,
} from '@careeros/firecrawl';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MissingCredentialError } from '../errors';

/**
 * Firecrawl job-source adapter (F4, owner decision U6).
 *
 * Discovery model: `search()` finds candidate listing URLs, then `scrape()`
 * pulls the full page for each hit. Firecrawl does the actual fetch, so our
 * egress stays pinned to `api.firecrawl.dev` (the client's allowlist); the
 * discovered URL is a parameter, not something this process requests directly.
 *
 * Trust: web-discovered listings are `DISCOVERED` — never VERIFIED. `tier: 3`
 * mirrors the trust-order ladder (1 VERIFIED ATS > 2 aggregator > 3 agent /
 * discovered). Promotion happens only downstream, once a listing resolves to
 * the employer's own ATS/career board (see trust-order/verify stages).
 *
 * Vendor-neutral by design: no host is filtered. Owner decision 2026-10-06
 * permits LinkedIn/Indeed/Naukri/Glassdoor to be discovered + scraped through
 * Firecrawl; direct first-party scraping and non-Firecrawl third-party
 * scrapers remain banned (AGENTS.md rule #4).
 */

export const FIRECRAWL_TRUST_TIER = 'DISCOVERED' as const;
export const FIRECRAWL_SOURCE_NAME = 'firecrawl';

/** Structural subset of FirecrawlClient we use — injectable for tests. */
export interface FirecrawlJobClient {
  search(req: FirecrawlSearchRequest): Promise<FirecrawlSearchResponse>;
  scrape(req: FirecrawlScrapeRequest): Promise<FirecrawlScrapeResponse>;
}

export interface FirecrawlAdapterOpts {
  /** Search queries. Defaults to $FIRECRAWL_JOB_QUERIES split on comma. */
  queries?: string[];
  /** Per-query result cap (Firecrawl max 100). Defaults 20. */
  searchLimit?: number;
  /** Scrape each discovered URL for the full description. Defaults true. */
  scrapeDetails?: boolean;
  /** Hard cap on scrape calls per `fetch()` so a run cannot blow the budget. Defaults 25. */
  maxScrapes?: number;
  /** Test hook / DI: supply a client instead of constructing one from env. */
  client?: FirecrawlJobClient;
  apiKey?: string;
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  retryBaseMs?: number;
  nodeEnv?: string;
  env?: NodeJS.ProcessEnv;
  scrapeOptions?: FirecrawlScrapeOptions;
}

export function createFirecrawlAdapter(opts: FirecrawlAdapterOpts = {}): JobSourceAdapter {
  const queries = opts.queries ?? envQueries();
  const searchLimit = opts.searchLimit ?? 20;
  const scrapeDetails = opts.scrapeDetails ?? true;
  const maxScrapes = opts.maxScrapes ?? 25;

  return {
    id: FIRECRAWL_SOURCE_NAME,
    name: 'Firecrawl',
    tier: 3,
    licenseHint:
      'Third-party crawler (U6-permitted for public career sites only). Listing rights owned by originating employer.',
    attribution: 'Discovered via Firecrawl (firecrawl.dev). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (queries.length === 0) return [];
      const client = opts.client ?? resolveClient(opts);
      const seen = new Set<string>();
      const out: RawJob[] = [];
      let scrapes = 0;

      for (const query of queries) {
        const request: FirecrawlSearchRequest = { query, limit: searchLimit };
        if (opts.scrapeOptions) request.scrapeOptions = opts.scrapeOptions;
        const res = await client.search(request);

        for (const result of res.data) {
          const canonical = canonicalUrlOf(result);
          if (!canonical || seen.has(canonical)) continue;
          seen.add(canonical);

          let detail: FirecrawlScrapeData | null = null;
          if (scrapeDetails && scrapes < maxScrapes) {
            scrapes += 1;
            try {
              const scraped = await client.scrape({
                url: result.url,
                formats: ['markdown'],
                onlyMainContent: true,
              });
              detail = scraped.data;
            } catch {
              // A single failed scrape degrades to the search snippet; it never
              // fails the whole run. The retry client already backed off.
              detail = null;
            }
          }

          const raw = mapFirecrawl(result, detail);
          if (raw) out.push(raw);
        }
      }
      return out;
    },
  };
}

/** Default registry instance. Env-driven queries; empty list → no network. */
export const firecrawlAdapter: JobSourceAdapter = createFirecrawlAdapter();

function envQueries(): string[] {
  const raw = process.env.FIRECRAWL_JOB_QUERIES ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveClient(opts: FirecrawlAdapterOpts): FirecrawlJobClient {
  const clientOpts: FirecrawlClientOptions = {
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.allowlist ? { allowlist: opts.allowlist } : {}),
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.retryAttempts !== undefined ? { retryAttempts: opts.retryAttempts } : {}),
    ...(opts.retryBaseMs !== undefined ? { retryBaseMs: opts.retryBaseMs } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  };
  try {
    return createFirecrawlClient(clientOpts);
  } catch (err) {
    if (err instanceof FirecrawlConfigError) {
      throw new MissingCredentialError(FIRECRAWL_SOURCE_NAME, ['FIRECRAWL_API_KEY']);
    }
    throw err;
  }
}

/**
 * @deprecated No-op since owner decision 2026-10-06 (LinkedIn/Indeed/Naukri/
 * Glassdoor are permitted via Firecrawl). Always returns `false`; kept so
 * existing importers keep compiling.
 */
export function isBannedPlatformUrl(_rawUrl: string): boolean {
  return false;
}

/** Canonical URL from Firecrawl metadata, falling back to the result URL. */
function canonicalUrlOf(result: FirecrawlSearchResult): string | null {
  const candidates = [result.metadata?.url, result.metadata?.sourceURL, result.url];
  for (const c of candidates) {
    if (typeof c === 'string' && z.string().url().safeParse(c).success) return c;
  }
  return null;
}

/**
 * Map one Firecrawl hit (+ optional scrape detail) to a `RawJob`. Returns null
 * when there is no usable title/url. Exported for tests.
 */
export function mapFirecrawl(
  result: FirecrawlSearchResult,
  detail: FirecrawlScrapeData | null = null,
): RawJob | null {
  const canonical = canonicalUrlOf(result);
  if (!canonical) return null;

  const markdown = detail?.markdown ?? result.markdown;
  const html = detail?.html ?? result.html;
  const title = (detail?.metadata?.title ?? result.title ?? firstHeading(markdown) ?? '').trim();
  if (!title) return null;

  let description = (markdown ?? (html ? stripHtml(html) : '') ?? result.description ?? '').trim();
  if (!description) description = result.description?.trim() || title;
  if (description.length > 50_000) description = description.slice(0, 50_000);

  const meta = (detail?.metadata ?? result.metadata) as Record<string, unknown> | undefined;
  const siteName = typeof meta?.['ogSiteName'] === 'string' ? meta['ogSiteName'].trim() : '';
  const company = siteName || companyFromUrl(canonical) || 'Unknown';

  const remote = /remote|anywhere|worldwide|work from home|\bwfh\b/i.test(
    `${title} ${description}`,
  );

  return {
    sourceId: firecrawlSourceId(canonical),
    sourceName: FIRECRAWL_SOURCE_NAME,
    canonicalUrl: canonical,
    title: title.slice(0, 300),
    company: company.slice(0, 200),
    location: null,
    remote,
    description,
    sourcePostedAt: null,
    fetchedAt: new Date(),
    payload: { search: result, scrape: detail },
  };
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const firecrawlRateLimit = RATE_LIMITS.firecrawl;

function firecrawlSourceId(canonical: string): string {
  const readable = `firecrawl:${canonical}`;
  if (readable.length <= 200) return readable;
  return `firecrawl:sha1:${createHash('sha1').update(canonical).digest('hex')}`;
}

/** Best-effort company from the listing URL (ATS token or the site host). */
export function companyFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const firstSegment = url.pathname.split('/').filter(Boolean)[0];
  const atsTokenHosts: readonly RegExp[] = [
    /(^|\.)ashbyhq\.com$/,
    /(^|\.)greenhouse\.io$/,
    /(^|\.)lever\.co$/,
    /(^|\.)smartrecruiters\.com$/,
    /(^|\.)icims\.com$/,
  ];
  for (const re of atsTokenHosts) {
    if (re.test(host) && firstSegment) return firstSegment;
  }
  if (/(^|\.)myworkdayjobs\.com$/.test(host)) return host.split('.')[0] ?? host;
  return host.replace(/^(jobs|careers|apply|boards)\./, '');
}

function firstHeading(markdown: string | undefined): string | null {
  if (!markdown) return null;
  const m = markdown.match(/^#{1,3}\s+(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
