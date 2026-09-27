/**
 * D.5d: smoke test for the fixture-mode selector-health probe.
 *
 * Verifies:
 *   - a full selector map + full fixture set reports `healthy: true`
 *   - swapping one selector to a bogus value flips it to `healthy: false`
 *     with the right key in `missing`.
 *
 * ponytail: no live-mode test — that lives behind LIVE=1 and needs a real
 * LinkedIn session, exactly the thing this whole D.5 stream is built to
 * avoid in CI.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELECTORS } from './lib/linkedin-selectors.js';
import { selectorHealth } from './probe-linkedin-selectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '__fixtures__', 'linkedin');

function loadAllFixtures(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.html'))) {
    out[f] = readFileSync(join(FIXTURE_DIR, f), 'utf-8');
  }
  return out;
}

describe('selectorHealth (D.5d)', () => {
  it('reports healthy=true when core selectors match the fixtures', () => {
    const bundle = loadAllFixtures();
    // Only probe the card-level selectors: search-page inputs
    // (searchInput/locationInput/nextButton) are not present in card
    // fixtures by design.
    const cardSelectors: Record<string, string> = {
      jobCard: SELECTORS.jobCard,
      jobLink: SELECTORS.jobLink,
      jobTitle: SELECTORS.jobTitle,
      company: SELECTORS.company,
      location: SELECTORS.location,
      postedAt: SELECTORS.postedAt,
    };
    const health = selectorHealth(bundle, cardSelectors);
    expect(health.healthy).toBe(true);
    expect(health.missing).toEqual([]);
  });

  it('flags a bogus selector as missing', () => {
    const bundle = loadAllFixtures();
    const broken = { ...SELECTORS, jobTitle: 'h3.this-does-not-exist-anywhere' };
    const health = selectorHealth(bundle, broken);
    expect(health.healthy).toBe(false);
    expect(health.missing).toContain('jobTitle');
  });
});
