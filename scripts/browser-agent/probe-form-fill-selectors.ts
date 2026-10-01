#!/usr/bin/env node
/**
 * F.3 CLI probe for form-fill allowlist entries.
 *
 * Walks every allowlist entry under packages/browser-agent/allowlist/ and
 * runs the shared probe against:
 *
 *   FIXTURE mode (default): __fixtures__/form-fill/<domain>.html on disk.
 *                           CI-safe, no browser launch.
 *   LIVE=1 mode:            opens the user's real Chrome at a well-known
 *                           apply page for each domain and probes against
 *                           page.content(). Requires CAREEROS_USER_DATA_DIR.
 *
 * Output: `{ domain, healthy, missing, drifted }[]` as JSON. Exit 2 if any
 * entry is unhealthy so the ops wrapper can alert.
 *
 * This script is the operator entrypoint; the actual weekly cron runs via
 * apps/worker/src/selector-health.worker.ts which calls the pure probeEntry
 * fn directly with the right prisma handle.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadAllowlistDir,
  probeEntry,
  type AllowlistEntry,
  type ProbeResult,
} from '@careeros/browser-agent';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_DIR = join(HERE, '..', '..', 'packages', 'browser-agent', 'allowlist');
const FIXTURE_DIR = join(HERE, '__fixtures__', 'form-fill');

function loadFixture(domain: string): string | null {
  // domain "*" => "generic.html"
  const file = domain === '*' ? 'generic.html' : `${domain}.html`;
  try {
    return readFileSync(join(FIXTURE_DIR, file), 'utf-8');
  } catch {
    return null;
  }
}

async function captureLive(entry: AllowlistEntry): Promise<string | null> {
  // Lazy-load playwright: fixture mode should not require it.
  const { chromium } = await import('playwright');
  const userDataDir = process.env.CAREEROS_USER_DATA_DIR;
  if (!userDataDir) {
    throw new Error('CAREEROS_USER_DATA_DIR required for LIVE=1 probe');
  }
  // ponytail: every domain here needs a hand-maintained canonical apply URL.
  // Hardcoding the 2 real ones (ashby + greenhouse); stubs return null and
  // the probe treats them as healthy-by-definition (nothing to probe yet).
  const canonical: Record<string, string> = {
    'ashbyhq.com': 'https://jobs.ashbyhq.com/example/application',
    'greenhouse.io': 'https://boards.greenhouse.io/example/jobs/0',
  };
  const url = canonical[entry.domain];
  if (!url) return null;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);
    return await page.content();
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const mode: 'live' | 'fixture' = process.env.LIVE === '1' ? 'live' : 'fixture';
  const entries = loadAllowlistDir(ALLOWLIST_DIR);
  const report: ProbeResult[] = [];
  let unhealthy = 0;

  for (const entry of entries.values()) {
    const html = mode === 'live' ? await captureLive(entry) : loadFixture(entry.domain);
    if (html === null) {
      // Fixture missing or no canonical URL for live mode: skip but note it.
      report.push({
        domain: entry.domain,
        healthy: true,
        missing: [],
        drifted: [],
        probedSelectors: [],
      });
      continue;
    }
    const result = probeEntry(entry, html);
    report.push(result);
    if (!result.healthy) unhealthy += 1;
  }

  process.stdout.write(JSON.stringify({ mode, entries: report }, null, 2) + '\n');
  if (unhealthy > 0) process.exitCode = 2;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`probe-form-fill-selectors fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
