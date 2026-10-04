/**
 * F7 candidate-search runner.
 *
 * Executes the query plan against a Firecrawl client, drops banned-platform
 * hits, scrapes details within a hard cap, and returns deduped `RawJob`s ready
 * for the shared job pipeline (`planIngest`). It owns no persistence and no
 * scheduling so both the API service and the worker can reuse it.
 *
 * `shouldStop` is the budget/kill-switch seam: the runner checks it before
 * every Firecrawl call and unwinds immediately, so an exhausted budget or a
 * tripped kill switch issues no further requests.
 */
import {
  isBannedPlatformUrl,
  mapFirecrawl,
  marketRequest,
  type FirecrawlJobClient,
} from '../adapters/firecrawl';
import type { RawJob } from '../types';
import type { FirecrawlScrapeData } from '@careeros/firecrawl';

export interface CandidateSearchRunOptions {
  client: FirecrawlJobClient;
  queries: string[];
  /** Market country (ISO-3166 alpha-2) forwarded to each search request. */
  country?: string;
  /** Market city/region forwarded to each search request as `location`. */
  location?: string;
  /** Per-query result cap (Firecrawl max 100). Default 20. */
  limit?: number;
  /** Scrape each discovered URL for the full description. Default false. */
  scrapeDetails?: boolean;
  /** Hard cap on scrape calls per run. Default 10. */
  maxScrapes?: number;
  /** Return true to stop before the next Firecrawl call (budget/kill switch). */
  shouldStop?: () => boolean;
  /** Accounting hook fired after each successful call. `credits` is an estimate. */
  onCall?: (kind: 'search' | 'scrape', credits: number) => void;
  /** Per-host pacing: minimum ms between search calls. Default 0. */
  minIntervalMs?: number;
  /** Injectable sleep for tests (used with `minIntervalMs`). */
  sleep?: (ms: number) => Promise<void>;
}

export interface CandidateSearchRunResult {
  raw: RawJob[];
  queriesRun: number;
  hitsScanned: number;
  bannedSkipped: number;
  duplicatesDropped: number;
  calls: { search: number; scrape: number };
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_SCRAPES = 10;
/** Estimate: one Firecrawl credit per successful call (search or scrape). */
const CREDITS_PER_CALL = 1;

export async function runCandidateSearch(
  options: CandidateSearchRunOptions,
): Promise<CandidateSearchRunResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const scrapeDetails = options.scrapeDetails ?? false;
  const maxScrapes = options.maxScrapes ?? DEFAULT_MAX_SCRAPES;
  const shouldStop = options.shouldStop ?? (() => false);
  const onCall = options.onCall ?? (() => {});
  const minIntervalMs = options.minIntervalMs ?? 0;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const result: CandidateSearchRunResult = {
    raw: [],
    queriesRun: 0,
    hitsScanned: 0,
    bannedSkipped: 0,
    duplicatesDropped: 0,
    calls: { search: 0, scrape: 0 },
  };

  const seen = new Set<string>();
  let scrapes = 0;

  const market = {
    ...(options.country ? { country: options.country } : {}),
    ...(options.location ? { location: options.location } : {}),
  };

  for (const query of options.queries) {
    if (shouldStop()) break;
    if (minIntervalMs > 0 && result.calls.search > 0) await sleep(minIntervalMs);
    const res = await options.client.search(marketRequest(query, limit, market));
    result.queriesRun++;
    result.calls.search++;
    onCall('search', CREDITS_PER_CALL);

    for (const hit of res.data) {
      result.hitsScanned++;
      if (isBannedPlatformUrl(hit.url)) {
        result.bannedSkipped++;
        continue;
      }

      let detail: FirecrawlScrapeData | null = null;
      if (scrapeDetails && scrapes < maxScrapes && !shouldStop()) {
        scrapes++;
        result.calls.scrape++;
        try {
          const scraped = await options.client.scrape({
            url: hit.url,
            formats: ['markdown'],
            onlyMainContent: true,
          });
          detail = scraped.data;
          onCall('scrape', CREDITS_PER_CALL);
        } catch {
          // A failed scrape degrades to the search snippet; never fails the run.
          detail = null;
        }
      }

      const raw = mapFirecrawl(hit, detail, market);
      if (!raw) continue;
      if (seen.has(raw.canonicalUrl)) {
        result.duplicatesDropped++;
        continue;
      }
      seen.add(raw.canonicalUrl);
      result.raw.push(raw);
    }
  }

  return result;
}
