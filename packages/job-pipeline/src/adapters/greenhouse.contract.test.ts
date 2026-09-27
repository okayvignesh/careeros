import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  GreenhouseBoardWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from './schemas';

/**
 * C-P3.6a — Greenhouse live contract test.
 *
 * Runs ONLY when ADAPTER_CONTRACT=1. We probe the `stripe` board — large,
 * long-lived, publicly documented. No operator credentials needed.
 */

const GREENHOUSE_TOKEN = 'stripe';
const GREENHOUSE_URL = `https://boards-api.greenhouse.io/v1/boards/${GREENHOUSE_TOKEN}/jobs?content=true`;
const ADAPTER_ID = 'greenhouse';

describe('greenhouse live contract', () => {
  it.runIf(shouldRunContract())(
    'live upstream matches wire schema + snapshot',
    async () => {
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(GREENHOUSE_URL, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} url=${GREENHOUSE_URL}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      // Authoritative drift signal: does the wire shape still validate?
      assertWireShape(ADAPTER_ID, GreenhouseBoardWire, payload);

      // Snapshot: human-readable shape reference, refresh via UPDATE_SNAPSHOTS=1.
      // Not gating — first-row shape varies day to day.
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'jobs'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
