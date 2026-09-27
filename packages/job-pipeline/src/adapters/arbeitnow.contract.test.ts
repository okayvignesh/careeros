import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  ArbeitnowResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from './schemas';

/**
 * C-P3.6a — Arbeitnow live contract test.
 *
 * Runs ONLY when ADAPTER_CONTRACT=1. Snapshot-refresh via UPDATE_SNAPSHOTS=1.
 * Upstream: https://www.arbeitnow.com/api/job-board-api — public, no auth.
 */

const ARBEITNOW_URL = 'https://www.arbeitnow.com/api/job-board-api';
const ADAPTER_ID = 'arbeitnow';

describe('arbeitnow live contract', () => {
  it.runIf(shouldRunContract())(
    'live upstream matches wire schema + snapshot',
    async () => {
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(ARBEITNOW_URL, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} url=${ARBEITNOW_URL}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      // Authoritative drift signal: does the wire shape still validate?
      assertWireShape(ADAPTER_ID, ArbeitnowResponseWire, payload);

      // Snapshot: human-readable shape reference, refresh via UPDATE_SNAPSHOTS=1.
      // Not gating — first-row shape varies day to day.
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'data'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
