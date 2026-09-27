import { describe, expect, it } from 'vitest';
import { retry } from '@careeros/shared';
import {
  AdzunaResponseWire,
  assertWireShape,
  minimizePayload,
  readSnapshot,
  shouldRunContract,
  shouldUpdateSnapshots,
  writeSnapshot,
} from './schemas';

/**
 * C-P3.6a — Adzuna live contract test.
 *
 * Runs ONLY when ADAPTER_CONTRACT=1 AND credentials are present. Adzuna free
 * tier is ~25 req/day — this test burns exactly ONE per run (single country,
 * single page, results_per_page=1). Weekly cron = 4 requests/month against
 * the daily budget.
 *
 * If credentials are missing, the test still executes but no-ops with a clear
 * console message so the workflow doesn't spuriously fail when secrets aren't
 * yet configured on the repo. Add ADZUNA_APP_ID + ADZUNA_APP_KEY as GitHub
 * secrets to enable real drift detection.
 */

const ADZUNA_COUNTRY = 'gb';
const ADAPTER_ID = 'adzuna';

describe('adzuna live contract', () => {
  it.runIf(shouldRunContract())(
    'live upstream matches wire schema + snapshot',
    async () => {
      const appId = process.env.ADZUNA_APP_ID ?? '';
      const appKey = process.env.ADZUNA_APP_KEY ?? '';
      if (!appId || !appKey) {
        // ponytail: soft-skip on missing creds. The workflow prints a warning;
        // upgrade path is to promote this to a hard fail once the repo admin
        // has added ADZUNA_APP_ID + ADZUNA_APP_KEY to GitHub secrets.
        console.warn(
          `[${ADAPTER_ID}] skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set. Add to GitHub secrets to enable drift detection.`,
        );
        return;
      }

      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        results_per_page: '1',
      });
      const url = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/1?${params.toString()}`;

      const payload = await retry(
        async () => {
          const res = await globalThis.fetch(url, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) {
            const err = new Error(
              `[${ADAPTER_ID}] live fetch failed: ${res.status} ${res.statusText} country=${ADZUNA_COUNTRY}`,
            ) as Error & { status: number };
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as unknown;
        },
        { attempts: 3, baseMs: 2_000 },
      );

      // Authoritative drift signal: does the wire shape still validate?
      assertWireShape(ADAPTER_ID, AdzunaResponseWire, payload);

      // Snapshot: human-readable shape reference, refresh via UPDATE_SNAPSHOTS=1.
      // Not gating — first-row shape varies day to day.
      if (shouldUpdateSnapshots()) {
        writeSnapshot(ADAPTER_ID, minimizePayload(payload, 'results'));
      }
      // adzuna snapshot may be null (creds absent means no run has generated
      // one yet); this test only reaches here when creds are present.
      expect(readSnapshot(ADAPTER_ID)).not.toBeNull();
    },
    30_000,
  );
});
