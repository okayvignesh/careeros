#!/usr/bin/env node
// C-P0.5c: nightly LLM eval drift calculator.
//
// Reads the current run's eval-results/summary.json and a directory of prior
// nightly summaries (downloaded by the workflow from the last 7 days), then
// writes eval-results/drift.json with the pass-rate delta and a regression
// verdict. Pure logic lives in `computeDrift` so it has a runnable unit check
// (scripts/__tests__/eval-drift.test.ts).
//
// Env:
//   CURRENT_SUMMARY  default eval-results/summary.json
//   BASELINE_DIR     default eval-baseline
//   OUT_PATH         default eval-results/drift.json
//   THRESHOLD        default 0.05 (5 percentage points)
//   EVAL_MODE        fallback mode label if the summary omits one
//
// Exit: always 0 on a computed verdict (even "no baseline"); non-zero only if
// the output cannot be written. A missing current summary is a failure, not a
// silent pass, so a broken runner cannot masquerade as green.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Case pass rate in [0, 1] for a summary document. */
export function passRate(summary) {
  const total = Number(summary?.overall?.total ?? 0);
  const passed = Number(summary?.overall?.passed ?? 0);
  return total > 0 ? passed / total : 0;
}

/**
 * Compare a current summary against prior summaries.
 * Regression = baseline pass rate minus current pass rate > threshold.
 */
export function computeDrift(current, baselines, threshold = 0.05) {
  const currentRate = passRate(current);
  const valid = baselines.filter((b) => Number(b?.overall?.total ?? 0) > 0);
  const baselineRate =
    valid.length === 0 ? null : valid.reduce((a, b) => a + passRate(b), 0) / valid.length;
  const delta = baselineRate === null ? 0 : currentRate - baselineRate;
  const regressed = baselineRate !== null && baselineRate - currentRate > threshold;
  return {
    currentRate,
    baselineRate,
    delta,
    regressed,
    baselineRuns: valid.length,
    threshold,
  };
}

function collectBaselineSummaries(dir) {
  if (!existsSync(dir)) return [];
  const summaries = [];
  for (const rel of readdirSync(dir, { recursive: true })) {
    if (typeof rel !== 'string' || !rel.endsWith('summary.json')) continue;
    try {
      summaries.push(JSON.parse(readFileSync(join(dir, rel), 'utf8')));
    } catch {
      // Ignore an unreadable prior artifact; it just drops out of the baseline.
    }
  }
  return summaries;
}

function main() {
  const currentPath = process.env.CURRENT_SUMMARY ?? 'eval-results/summary.json';
  const baselineDir = process.env.BASELINE_DIR ?? 'eval-baseline';
  const outPath = process.env.OUT_PATH ?? 'eval-results/drift.json';
  const threshold = Number(process.env.THRESHOLD ?? '0.05');

  if (!existsSync(currentPath)) {
    console.error(`eval-drift: current summary not found at ${currentPath}`);
    process.exit(1);
  }
  const current = JSON.parse(readFileSync(currentPath, 'utf8'));
  const baselines = collectBaselineSummaries(baselineDir);
  const drift = computeDrift(current, baselines, threshold);
  const mode = current?.mode ?? process.env.EVAL_MODE ?? 'mock';

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    current: {
      total: Number(current?.overall?.total ?? 0),
      passed: Number(current?.overall?.passed ?? 0),
      passRate: drift.currentRate,
    },
    baseline: {
      runs: drift.baselineRuns,
      passRate: drift.baselineRate,
    },
    delta: drift.delta,
    threshold: drift.threshold,
    regressed: drift.regressed,
    reason:
      drift.baselineRate === null
        ? 'no baseline artifacts in the 7-day window'
        : drift.regressed
          ? `pass rate dropped ${(drift.threshold * 100).toFixed(1)}+ points vs ${drift.baselineRuns}-run baseline`
          : 'within threshold',
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `eval-drift: mode=${mode} current=${(drift.currentRate * 100).toFixed(1)}% ` +
      `baseline=${drift.baselineRate === null ? 'n/a' : `${(drift.baselineRate * 100).toFixed(1)}%`} ` +
      `delta=${(drift.delta * 100).toFixed(1)}pp regressed=${drift.regressed}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
