#!/usr/bin/env node
/**
 * D.5c: linkedin-discover — first browser-agent script.
 *
 * Opens the user's real Chrome via `chromium.launchPersistentContext(userDataDir)`
 * (LinkedIn's anti-bot won't accept a fresh bundled Chromium), navigates to
 * /jobs/search, applies the requested filters, scrolls to load more results,
 * scrapes every visible job card via `parseJobCard` (pure fn from D.5a), and
 * emits `RawJob[]` to stdout as JSON.
 *
 * Every DOM read is wrapped in try/catch. If a required selector goes
 * missing we don't throw: we return `{ status: 'selector-broken', missing }`
 * so the runner can flag drift and page the operator instead of returning
 * silently-empty results.
 *
 * Pacing: 6 req/min via the D.1 `RateLimiter` (stubbed inline until D.1's
 * package publishes its exports).
 *
 * Screenshots on error: written to /var/log/careeros/agent-screenshots.
 * D.8 owns the 30-day cleanup cron.
 *
 * Invocation:
 *   LIVE=1 CAREEROS_USER_DATA_DIR=~/Library/.../Chrome node --loader tsx \
 *     scripts/browser-agent/linkedin-discover.ts \
 *     --query "backend engineer" --location "Remote" --remote --max 25
 *
 * Or via env:
 *   DISCOVER_SEARCH_QUERY="backend engineer" DISCOVER_LOCATION="Remote" \
 *   DISCOVER_REMOTE_ONLY=1 DISCOVER_MAX_RESULTS=25 node ...
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJobCard, type RawJob } from './lib/linkedin-parse.js';
import { SELECTORS, SELECTOR_VERSION } from './lib/linkedin-selectors.js';

// -----------------------------------------------------------------------------
// D.1 stubs. Replace `import { RateLimiter, selectorHealth } from
// '@careeros/browser-agent'` once D.1 ships those exports.
// -----------------------------------------------------------------------------
// TODO(D.1): swap in RateLimiter when @careeros/browser-agent ships
class RateLimiter {
  private lastRequestAt = 0;
  private readonly minGapMs: number;
  constructor(perMinute: number) {
    this.minGapMs = Math.ceil(60_000 / perMinute);
  }
  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const remaining = this.minGapMs - elapsed;
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    this.lastRequestAt = Date.now();
  }
}
// -----------------------------------------------------------------------------

export interface DiscoverInput {
  searchQuery: string;
  location: string;
  remoteOnly?: boolean;
  maxResults?: number;
}

export type DiscoverResult =
  | { status: 'ok'; jobs: RawJob[]; selectorVersion: string }
  | { status: 'selector-broken'; missing: string[]; selectorVersion: string }
  | { status: 'error'; error: string; screenshotPath?: string };

const SCREENSHOT_DIR = process.env.CAREEROS_SCREENSHOT_DIR ?? '/var/log/careeros/agent-screenshots';

function readInput(): DiscoverInput {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const searchQuery = getArg('--query') ?? process.env.DISCOVER_SEARCH_QUERY ?? '';
  const location = getArg('--location') ?? process.env.DISCOVER_LOCATION ?? '';
  const remoteOnly =
    args.includes('--remote') || process.env.DISCOVER_REMOTE_ONLY === '1';
  const maxStr = getArg('--max') ?? process.env.DISCOVER_MAX_RESULTS;
  const maxResults = maxStr ? Number(maxStr) : 25;
  if (!searchQuery) throw new Error('searchQuery required (--query or DISCOVER_SEARCH_QUERY)');
  if (!location) throw new Error('location required (--location or DISCOVER_LOCATION)');
  if (!Number.isFinite(maxResults) || maxResults <= 0) {
    throw new Error('maxResults must be a positive number');
  }
  return { searchQuery, location, remoteOnly, maxResults };
}

/** Wrap every DOM read: on failure, record the selector as missing. */
async function tryFind<T>(
  fn: () => Promise<T>,
  missing: string[],
  label: string,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    missing.push(`${label}: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

async function takeErrorScreenshot(page: Page, label: string): Promise<string | undefined> {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const path = join(SCREENSHOT_DIR, `linkedin-discover-${label}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch {
    // ponytail: silent — screenshot dir may not be writable in local dev
    return undefined;
  }
}

async function scrapeCards(page: Page, limit: number): Promise<{ html: string[]; missing: string[] }> {
  const missing: string[] = [];
  const html: string[] = [];

  // Wait for the results list. If missing, treat as selector-broken.
  const listFound = await tryFind(
    () => page.waitForSelector(SELECTORS.resultsList, { timeout: 10_000 }),
    missing,
    'resultsList',
  );
  if (!listFound) return { html, missing };

  // Scroll to load more cards. LinkedIn lazy-loads via IntersectionObserver.
  let previousCount = 0;
  for (let i = 0; i < 10 && html.length < limit; i += 1) {
    const cards = await tryFind(
      () => page.$$(SELECTORS.jobCard),
      missing,
      'jobCard',
    );
    if (!cards) break;
    if (cards.length === previousCount) break; // no more to load
    previousCount = cards.length;

    for (const card of cards.slice(0, limit)) {
      const outer = await tryFind(
        () => card.evaluate((el: Element) => el.outerHTML),
        missing,
        'cardOuterHTML',
      );
      if (outer) html.push(outer);
    }
    if (html.length >= limit) break;

    // Scroll last card into view to trigger more loads.
    await tryFind(
      () => cards[cards.length - 1]!.scrollIntoViewIfNeeded(),
      missing,
      'scrollIntoView',
    );
    await page.waitForTimeout(1200);
  }

  return { html: html.slice(0, limit), missing };
}

export async function runDiscover(
  input: DiscoverInput,
  context: BrowserContext,
): Promise<DiscoverResult> {
  const limiter = new RateLimiter(6); // 6 req/min per plan
  const page = await context.newPage();
  const missing: string[] = [];

  try {
    await limiter.wait();
    // Direct URL rather than typing into search inputs = fewer selectors to
    // depend on. Falls through to jobs search page.
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.searchParams.set('keywords', input.searchQuery);
    url.searchParams.set('location', input.location);
    if (input.remoteOnly) url.searchParams.set('f_WT', '2');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await limiter.wait();
    const { html, missing: scrapeMissing } = await scrapeCards(page, input.maxResults ?? 25);
    missing.push(...scrapeMissing);

    // If we couldn't get any card HTML at all AND we have missing selectors,
    // that's selector-broken (not just an empty result set).
    if (html.length === 0 && missing.length > 0) {
      return { status: 'selector-broken', missing, selectorVersion: SELECTOR_VERSION };
    }

    const now = new Date();
    const jobs: RawJob[] = [];
    for (const fragment of html) {
      const job = parseJobCard(fragment, now);
      if (job) jobs.push(job);
    }
    return { status: 'ok', jobs, selectorVersion: SELECTOR_VERSION };
  } catch (err) {
    const screenshotPath = await takeErrorScreenshot(page, 'fatal');
    const errPayload: { status: 'error'; error: string; screenshotPath?: string } = {
      status: 'error',
      error: (err as Error).message,
    };
    if (screenshotPath !== undefined) errPayload.screenshotPath = screenshotPath;
    return errPayload;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const input = readInput();
  const userDataDir = process.env.CAREEROS_USER_DATA_DIR;
  if (!userDataDir) {
    throw new Error('CAREEROS_USER_DATA_DIR required (path to real Chrome profile)');
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  try {
    const result = await runDiscover(input, context);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'ok') process.exitCode = 1;
  } finally {
    await context.close();
  }
}

// Only run when invoked as a script (not when imported for testing).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`linkedin-discover fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
