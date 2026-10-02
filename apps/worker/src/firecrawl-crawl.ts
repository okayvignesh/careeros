/**
 * F8 crawl phase: start Firecrawl crawls for configured public career-site
 * targets, then poll `getCrawlStatus` with a bounded poll budget.
 *
 * Polling is paced (default 15s between polls → 4/min, under the 10/min
 * search ceiling and comfortably inside the documented 2/min crawl ceiling)
 * and gated by the same budget + kill switch as search: a tripped switch or an
 * exhausted budget stops polling immediately, leaving the crawl server-side.
 */
import type { FirecrawlClient, FirecrawlCrawlStatus } from '@careeros/firecrawl';
import { mapFirecrawl } from '@careeros/job-pipeline';
import type { RawJob } from '@careeros/job-pipeline';
import { isFirecrawlKilled, type FirecrawlBudget } from './firecrawl-budget.js';

export interface CrawlPhaseOptions {
  client: Pick<FirecrawlClient, 'crawl' | 'getCrawlStatus'>;
  /** Absolute URLs of public career boards / ATS sites to crawl. */
  targets: string[];
  budget: FirecrawlBudget;
  logger: { info: (ctx: object, msg: string) => void; warn: (ctx: object, msg: string) => void };
  env?: NodeJS.ProcessEnv;
  /** Max polls per crawl. Default 6. */
  maxPolls?: number;
  /** Delay between polls. Default 15_000 ms. */
  pollIntervalMs?: number;
  /** Injectable sleep for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CrawlPhaseResult {
  raw: RawJob[];
  started: number;
  creditsUsed: number;
  statuses: string[];
  polls: number;
  killed: boolean;
}

const DEFAULT_MAX_POLLS = 6;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export async function runCrawlPhase(options: CrawlPhaseOptions): Promise<CrawlPhaseResult> {
  const env = options.env ?? process.env;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const result: CrawlPhaseResult = {
    raw: [],
    started: 0,
    creditsUsed: 0,
    statuses: [],
    polls: 0,
    killed: false,
  };

  const seen = new Set<string>();
  const shouldStop = () => isFirecrawlKilled(env) || !options.budget.allow(1);

  for (const target of options.targets) {
    if (shouldStop()) {
      result.killed = true;
      break;
    }
    let jobId: string;
    try {
      const job = await options.client.crawl({
        url: target,
        limit: 25,
        allowExternalLinks: false,
        allowSubdomains: false,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });
      jobId = job.id;
      result.started++;
      options.budget.spend(1);
    } catch (err) {
      options.logger.warn({ target, err: (err as Error).message }, 'firecrawl crawl start failed');
      continue;
    }

    const status = await pollCrawlStatus(options.client, jobId, {
      maxPolls,
      pollIntervalMs,
      sleep,
      budget: options.budget,
      shouldStop,
      onStatus: (s) => {
        result.statuses.push(s.status);
        if (typeof s.creditsUsed === 'number') result.creditsUsed = s.creditsUsed;
        result.polls++;
      },
    });

    for (const page of status.data) {
      const url = page.metadata?.url ?? page.metadata?.sourceURL;
      if (!url) continue;
      const raw = mapFirecrawl({ url, markdown: page.markdown, metadata: page.metadata }, page);
      if (!raw || seen.has(raw.canonicalUrl)) continue;
      seen.add(raw.canonicalUrl);
      result.raw.push(raw);
    }
    // Firecrawl reports crawl credits on the status; charge the delta so the
    // budget reflects real spend rather than one-credit-per-poll.
    if (typeof status.creditsUsed === 'number' && status.creditsUsed > 0) {
      options.budget.spend(status.creditsUsed);
    }
  }

  return result;
}

export interface PollOptions {
  maxPolls: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  budget: FirecrawlBudget;
  shouldStop: () => boolean;
  onStatus?: (status: FirecrawlCrawlStatus) => void;
}

/**
 * Poll a crawl until terminal (`completed`/`failed`/`cancelled`), the poll
 * budget is spent, or the run must stop. Always returns the last status seen;
 * `data` is empty when nothing terminal arrived.
 */
export async function pollCrawlStatus(
  client: Pick<FirecrawlClient, 'getCrawlStatus'>,
  jobId: string,
  options: PollOptions,
): Promise<FirecrawlCrawlStatus> {
  let last: FirecrawlCrawlStatus = {
    status: 'scraping',
    completed: 0,
    total: 0,
    data: [],
  };
  for (let poll = 0; poll < options.maxPolls; poll++) {
    if (options.shouldStop()) return last;
    if (poll > 0) await options.sleep(options.pollIntervalMs);
    last = await client.getCrawlStatus(jobId);
    options.onStatus?.(last);
    if (last.status !== 'scraping') return last;
  }
  return last;
}
