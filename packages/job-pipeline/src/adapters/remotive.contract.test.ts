import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  RemotiveFeedWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from './schemas';

/**
 * C-P3.6a — Remotive live contract test.
 *
 * Runs ONLY when ADAPTER_CONTRACT=1 (weekly workflow). Skipped on PR CI to
 * keep the PR gate hermetic. Regenerate the snapshot with:
 *   ADAPTER_CONTRACT=1 UPDATE_SNAPSHOTS=1 pnpm exec vitest run remotive.contract
 *
 * Upstream: https://remotive.com/api/remote-jobs — public, unauthenticated.
 */

const REMOTIVE_URL = 'https://remotive.com/api/remote-jobs?limit=1';
const ADAPTER_ID = 'remotive';

describe('remotive live contract', () => {
  it.runIf(shouldRunContract())(
    'live upstream matches wire schema + snapshot',
    async () => {
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(REMOTIVE_URL, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} url=${REMOTIVE_URL}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      // Authoritative drift signal: does the wire shape still validate?
      assertWireShape(ADAPTER_ID, RemotiveFeedWire, payload);

      // Snapshot: human-readable shape reference (type-tree of the first
      // row), refreshed on demand via UPDATE_SNAPSHOTS=1. Not gating —
      // first-row shape varies day to day (optional fields, per-listing
      // quirks) so an equality check would flap. The workflow renders the
      // snapshot into the drift-issue body for context.
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'jobs'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
