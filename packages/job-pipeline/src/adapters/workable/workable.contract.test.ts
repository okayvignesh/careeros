import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  WorkableBoardWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * Workable live contract test.
 *
 * The recorded fixture is validated hermetically on every run. The live probe
 * runs only when `ADAPTER_CONTRACT=1` AND `WORKABLE_CONTRACT_ACCOUNT` is set (a
 * real Workable account slug); it is skipped cleanly otherwise.
 */

const ADAPTER_ID = 'workable';
const ACCOUNT = process.env.WORKABLE_CONTRACT_ACCOUNT ?? '';
const enabled = shouldRunContract() && ACCOUNT !== '';

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'workable.json'), 'utf8'),
) as unknown;

describe('workable contract (recorded fixture)', () => {
  it('recorded fixture matches the wire schema', () => {
    expect(() => assertWireShape(ADAPTER_ID, WorkableBoardWire, FIXTURE)).not.toThrow();
  });
});

describe('workable live contract', () => {
  it.runIf(enabled)(
    'live upstream matches wire schema + snapshot',
    async () => {
      const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(ACCOUNT)}?details=true`;
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, { headers: { accept: 'application/json' } });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} account=${ACCOUNT}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      assertWireShape(ADAPTER_ID, WorkableBoardWire, payload);
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'jobs'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
