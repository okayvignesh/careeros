import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  LeverBoardWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * Lever live contract test.
 *
 * The recorded fixture is validated hermetically on every run so a schema edit
 * cannot silently drift from the captured upstream shape. The live probe runs
 * only when `ADAPTER_CONTRACT=1` AND `LEVER_CONTRACT_SITE` is set (a real site
 * slug); it is skipped cleanly otherwise.
 */

const ADAPTER_ID = 'lever';
const SITE = process.env.LEVER_CONTRACT_SITE ?? '';
const enabled = shouldRunContract() && SITE !== '';

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'lever.json'), 'utf8'),
) as unknown;

describe('lever contract (recorded fixture)', () => {
  it('recorded fixture matches the wire schema', () => {
    expect(() => assertWireShape(ADAPTER_ID, LeverBoardWire, FIXTURE)).not.toThrow();
  });
});

describe('lever live contract', () => {
  it.runIf(enabled)(
    'live upstream matches wire schema + snapshot',
    async () => {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(SITE)}?mode=json&limit=10`;
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, { headers: { accept: 'application/json' } });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} site=${SITE}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      assertWireShape(ADAPTER_ID, LeverBoardWire, payload);
      if (shouldUpdateSnapshots()) {
        const rows = Array.isArray(payload) ? payload : [];
        writeSnapshot(ADAPTER_ID, minimizePayload({ jobs: rows }, 'jobs'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
