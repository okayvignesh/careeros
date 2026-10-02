import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  SmartRecruitersResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * SmartRecruiters live contract test.
 *
 * The recorded fixture is validated hermetically on every run. The live probe
 * runs only when `ADAPTER_CONTRACT=1` AND `SMARTRECRUITERS_CONTRACT_COMPANY` is
 * set (a real company identifier); it is skipped cleanly otherwise.
 */

const ADAPTER_ID = 'smartrecruiters';
const COMPANY = process.env.SMARTRECRUITERS_CONTRACT_COMPANY ?? '';
const enabled = shouldRunContract() && COMPANY !== '';

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'smartrecruiters.json'),
    'utf8',
  ),
) as unknown;

describe('smartrecruiters contract (recorded fixture)', () => {
  it('recorded fixture matches the wire schema', () => {
    expect(() =>
      assertWireShape(ADAPTER_ID, SmartRecruitersResponseWire, FIXTURE),
    ).not.toThrow();
  });
});

describe('smartrecruiters live contract', () => {
  it.runIf(enabled)(
    'live upstream matches wire schema + snapshot',
    async () => {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(COMPANY)}/postings?limit=2`;
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, { headers: { accept: 'application/json' } });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} company=${COMPANY}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      const parsed = assertWireShape(ADAPTER_ID, SmartRecruitersResponseWire, payload);
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'content'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
      expect(parsed.content).toBeDefined();
    },
    30_000,
  );
});
