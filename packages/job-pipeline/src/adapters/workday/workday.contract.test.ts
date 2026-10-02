import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  WorkdayDetailWire,
  WorkdayJobsWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from '../schemas';

/**
 * F5 — Workday live contract test.
 *
 * A real Workday board needs a real tenant/host/site, so this runs only when
 * `ADAPTER_CONTRACT=1` AND `WORKDAY_CONTRACT_HOST` + `WORKDAY_CONTRACT_TENANT`
 * are set. Site defaults to `External`. The list call is public and keyless;
 * the detail call follows the first `externalPath`. Snapshot refresh via
 * `UPDATE_SNAPSHOTS=1`.
 */

const ADAPTER_ID = 'workday';
const HOST = process.env.WORKDAY_CONTRACT_HOST ?? '';
const TENANT = process.env.WORKDAY_CONTRACT_TENANT ?? '';
const SITE = process.env.WORKDAY_CONTRACT_SITE ?? 'External';

const enabled = shouldRunContract() && HOST !== '' && TENANT !== '';
const API = `https://${HOST}/wday/cxs/${TENANT}/${SITE}`;

describe('workday live contract', () => {
  it.runIf(enabled)(
    'live list + detail match wire schemas + snapshot',
    async () => {
      const list = await retry(
        async () => {
          const res = await globalThis.fetch(`${API}/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live list failed: ${res.status} ${res.statusText} url=${API}/jobs`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 1_000 },
      );

      const parsed = assertWireShape(ADAPTER_ID, WorkdayJobsWire, list);
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(list, 'jobPostings'));
      }
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();

      const first = parsed.jobPostings[0];
      if (first) {
        const res = await globalThis.fetch(`${API}${first.externalPath}`, {
          headers: { accept: 'application/json' },
        });
        expect(res.ok).toBe(true);
        assertWireShape(ADAPTER_ID, WorkdayDetailWire, await res.json());
      }
    },
    60_000,
  );
});
