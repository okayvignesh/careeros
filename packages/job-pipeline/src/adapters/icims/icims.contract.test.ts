import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  IcimsSearchResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * iCIMS live contract test.
 *
 * The recorded fixture is validated hermetically on every run. The live probe
 * runs only when `ADAPTER_CONTRACT=1` AND `ICIMS_CONTRACT_CUSTOMER_ID` +
 * `ICIMS_CONTRACT_API_USER` + `ICIMS_CONTRACT_API_PASSWORD` are set (partner
 * credentials); it is skipped cleanly otherwise.
 */

const ADAPTER_ID = 'icims';
const CUSTOMER = process.env.ICIMS_CONTRACT_CUSTOMER_ID ?? '';
const PORTAL = process.env.ICIMS_CONTRACT_PORTAL_ID ?? 'jobs';
const USER = process.env.ICIMS_CONTRACT_API_USER ?? '';
const PASSWORD = process.env.ICIMS_CONTRACT_API_PASSWORD ?? '';
const enabled = shouldRunContract() && CUSTOMER !== '' && USER !== '' && PASSWORD !== '';

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'icims.json'), 'utf8'),
) as unknown;

describe('icims contract (recorded fixture)', () => {
  it('recorded fixture matches the wire schema', () => {
    expect(() => assertWireShape(ADAPTER_ID, IcimsSearchResponseWire, FIXTURE)).not.toThrow();
  });
});

describe('icims live contract', () => {
  it.runIf(enabled)(
    'live upstream matches wire schema + snapshot',
    async () => {
      const url = `https://api.icims.com/customers/${encodeURIComponent(CUSTOMER)}/search/portals/${encodeURIComponent(PORTAL)}?page=1&pageSize=25`;
      const auth = Buffer.from(`${USER}:${PASSWORD}`, 'utf8').toString('base64');
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, {
            headers: { accept: 'application/json', authorization: `Basic ${auth}` },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      assertWireShape(ADAPTER_ID, IcimsSearchResponseWire, payload);
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'searchResults'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
