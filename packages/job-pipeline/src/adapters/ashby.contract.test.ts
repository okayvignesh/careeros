import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  AshbyBoardWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from './schemas';

/**
 * C-P3.6a — Ashby live contract test.
 *
 * Runs ONLY when ADAPTER_CONTRACT=1. `Ashby` itself keeps a public job board
 * hosted on their own posting API, so we use `ashby` as a self-hosting probe
 * — small, stable, no operator credentials needed.
 */

const ASHBY_ORG = 'ashby';
const ASHBY_URL = `https://api.ashbyhq.com/posting-api/job-board/${ASHBY_ORG}?includeCompensation=true`;
const ADAPTER_ID = 'ashby';

describe('ashby live contract', () => {
  it.runIf(shouldRunContract())(
    'live upstream matches wire schema + snapshot',
    async () => {
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(ASHBY_URL, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} url=${ASHBY_URL}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      assertWireShape(ADAPTER_ID, AshbyBoardWire, payload);
      const minimized = minimizePayload(payload, 'jobs');

      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimized);
        return;
      }
      const prior = readSnapshot(ADAPTER_ID);
      expect(
        prior,
        `no snapshot for ${ADAPTER_ID}; run UPDATE_SNAPSHOTS=1 first`,
      ).not.toBeNull();
      expect(JSON.parse(JSON.stringify(minimized))).toEqual(prior);
    },
    30_000,
  );
});
