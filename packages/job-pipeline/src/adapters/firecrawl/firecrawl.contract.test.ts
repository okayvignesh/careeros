import { describe, expect, it } from 'vitest';
import { createFirecrawlClient, isFirecrawlConfigured } from '@careeros/firecrawl';
import {
  FirecrawlSearchResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * F4 — Firecrawl live contract test.
 *
 * Runs ONLY when BOTH `ADAPTER_CONTRACT=1` AND `FIRECRAWL_API_KEY` are set:
 * unlike the other adapters this probe is a paid external service, so a missing
 * key must skip cleanly rather than fail. `search` is the cheapest call
 * (2 credits / 10 results). Snapshot refresh via `UPDATE_SNAPSHOTS=1`.
 */

const ADAPTER_ID = 'firecrawl';
const QUERY = 'site:jobs.ashbyhq.com software engineer';

describe('firecrawl live contract', () => {
  it.runIf(shouldRunContract() && isFirecrawlConfigured())(
    'live search matches wire schema + snapshot',
    async () => {
      const client = createFirecrawlClient({ retryAttempts: 2, retryBaseMs: 1_000 });
      const payload = await client.search({ query: QUERY, limit: 5 });

      assertWireShape(ADAPTER_ID, FirecrawlSearchResponseWire, payload);

      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'data'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    60_000,
  );
});
