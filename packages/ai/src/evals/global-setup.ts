// C-P0.5c: eval vitest global setup. Runs once in the main process, after all
// eval files have written their per-suite part files. Merges them into the
// canonical junit.xml + summary.json the nightly-evals workflow uploads.
//
// Mode is honest, not asserted: `live` only when setup.live.ts actually
// registered a real provider (it drops a marker file); otherwise `mock`.
import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aggregateEvalArtifacts } from './runner';

export function setup(): void {
  // Nothing to do until the workers have run.
}

export function teardown(): void {
  const outDir = resolve(process.env.EVAL_OUT_DIR ?? 'eval-results');
  const marker = join(outDir, '.live-registered');
  const live = existsSync(marker);
  try {
    aggregateEvalArtifacts(outDir, { mode: live ? 'live' : 'mock' });
  } catch (err) {
    console.warn('eval artifact aggregation failed:', err);
  } finally {
    if (live) {
      try {
        unlinkSync(marker);
      } catch {
        // marker is best-effort; a stale one only mislabels the next run.
      }
    }
  }
}
