#!/usr/bin/env node
/**
 * D.5d: selector-health probe for LinkedIn.
 *
 * Walks every entry in `SELECTORS` and reports which ones no longer match
 * the DOM. Two modes:
 *
 *   LIVE=1 → opens LinkedIn Jobs (search page with a benign default query)
 *            via the user's real Chrome and probes against the live DOM.
 *   default → probes against the last-saved fixture set under
 *            __fixtures__/linkedin/. Reasonable coverage without hitting
 *            LinkedIn, safe to run in CI.
 *
 * Output shape:
 *   { healthy: boolean, missing: string[], drifted: string[],
 *     selectorVersion: string, mode: 'live' | 'fixture' }
 *
 * D.8 wires this up as a weekly cron; on `healthy: false` it should page
 * the operator (drifted selectors mean the discover script is silently
 * returning zero rows).
 *
 * TODO(D.1): replace the inline `selectorHealth` shim with the real one
 * from @careeros/browser-agent once D.1 ships its exports.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load } from 'cheerio';
import { SELECTORS, SELECTOR_VERSION, type SelectorKey } from './lib/linkedin-selectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// TODO(D.1): swap in selectorHealth from @careeros/browser-agent
/**
 * Purely-static selector-health check. Takes the concatenated HTML across
 * every fixture (or a live page snapshot) and asks: does each selector in
 * the map still find at least one element somewhere?
 *
 * "missing" = selector matches zero elements.
 * "drifted" = selector matches only in some fixtures but not the rest
 *             (partial drift: LinkedIn A/B is rolling out a redesign).
 */
export function selectorHealth(
  htmlByLabel: Record<string, string>,
  selectors: Record<string, string>,
): { healthy: boolean; missing: string[]; drifted: string[] } {
  const missing: string[] = [];
  const drifted: string[] = [];
  const entries = Object.entries(selectors);
  const fixtureLabels = Object.keys(htmlByLabel);
  const fixtureCount = fixtureLabels.length;

  for (const [key, selector] of entries) {
    let hits = 0;
    for (const label of fixtureLabels) {
      try {
        const html = htmlByLabel[label];
        if (!html) continue;
        const $ = load(html);
        if ($(selector).length > 0) hits += 1;
      } catch {
        // ponytail: a fixture that fails to load counts as no-hit
      }
    }
    if (hits === 0) missing.push(key);
    else if (fixtureCount > 1 && hits < Math.max(1, Math.floor(fixtureCount / 3))) {
      drifted.push(key);
    }
  }

  return { healthy: missing.length === 0 && drifted.length === 0, missing, drifted };
}

function loadFixtureBundle(): Record<string, string> {
  const fixtureDir = join(HERE, '__fixtures__', 'linkedin');
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.html'));
  const out: Record<string, string> = {};
  for (const f of files) {
    out[f] = readFileSync(join(fixtureDir, f), 'utf-8');
  }
  return out;
}

async function loadLiveBundle(): Promise<Record<string, string>> {
  // Lazy-load playwright: fixture mode should not require it.
  const { chromium } = await import('playwright');
  const userDataDir = process.env.CAREEROS_USER_DATA_DIR;
  if (!userDataDir) {
    throw new Error('CAREEROS_USER_DATA_DIR required for LIVE=1 probe');
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
  });
  try {
    const page = await context.newPage();
    // Benign default: search for "software engineer" in a common location.
    await page.goto(
      'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Remote',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    // Give lazy content a moment to hydrate.
    await page.waitForTimeout(3000);
    const html = await page.content();
    return { 'live:jobs-search': html };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const mode: 'live' | 'fixture' = process.env.LIVE === '1' ? 'live' : 'fixture';
  const bundle = mode === 'live' ? await loadLiveBundle() : loadFixtureBundle();

  // Cast SELECTORS to plain record for the shared helper.
  const asRecord: Record<string, string> = {};
  for (const key of Object.keys(SELECTORS) as SelectorKey[]) {
    asRecord[key] = SELECTORS[key];
  }
  const result = selectorHealth(bundle, asRecord);

  const report = {
    ...result,
    selectorVersion: SELECTOR_VERSION,
    mode,
    fixturesProbed: Object.keys(bundle).length,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!result.healthy) process.exitCode = 2;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`probe-linkedin-selectors fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
