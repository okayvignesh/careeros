import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  SuccessFactorsResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * SuccessFactors live contract test.
 *
 * The recorded fixture is validated hermetically on every run. The live probe
 * runs only when `ADAPTER_CONTRACT=1` AND `SF_CONTRACT_API_HOST` +
 * `SF_CONTRACT_COMPANY_ID` + `SF_CONTRACT_API_USER` + `SF_CONTRACT_API_PASSWORD`
 * are set (tenant credentials); it is skipped cleanly otherwise.
 */

const ADAPTER_ID = 'successfactors';
const HOST = process.env.SF_CONTRACT_API_HOST ?? '';
const COMPANY = process.env.SF_CONTRACT_COMPANY_ID ?? '';
const USER = process.env.SF_CONTRACT_API_USER ?? '';
const PASSWORD = process.env.SF_CONTRACT_API_PASSWORD ?? '';
const enabled = shouldRunContract() && HOST !== '' && COMPANY !== '' && USER !== '' && PASSWORD !== '';

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'successfactors.json'),
    'utf8',
  ),
) as unknown;

describe('successfactors contract (recorded fixture)', () => {
  it('recorded fixture matches the wire schema', () => {
    expect(() =>
      assertWireShape(ADAPTER_ID, SuccessFactorsResponseWire, FIXTURE),
    ).not.toThrow();
  });
});

describe('successfactors live contract', () => {
  it.runIf(enabled)(
    'live upstream matches wire schema + snapshot',
    async () => {
      const url = `https://${HOST}/odata/v2/JobRequisition?$top=5&$skip=0&$format=json&$select=jobReqId,jobTitle,jobDescription,location,createdDateTime,status`;
      const auth = Buffer.from(`${USER}@${COMPANY}:${PASSWORD}`, 'utf8').toString('base64');
      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, {
            headers: { accept: 'application/json', authorization: `Basic ${auth}` },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} tenant=${COMPANY}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      assertWireShape(ADAPTER_ID, SuccessFactorsResponseWire, payload);
      if (shouldUpdateSnapshots()) {
        const results =
          payload && typeof payload === 'object' && 'd' in payload
            ? ((payload as { d?: { results?: unknown[] } }).d?.results ?? [])
            : [];
        writeSnapshot(ADAPTER_ID, minimizePayload({ jobs: results }, 'jobs'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
