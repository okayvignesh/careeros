// C-P1.4c: real vitest suite for the skill-extract eval.
//
// - EVAL_MOCK=1 (default): mock provider, every fixture asserts judge passes.
//   This is what the nightly-evals workflow runs.
// - EVAL_LIVE=1 (opt-in): resolves the DeepseekProvider from packages/ai
//   registry (via a caller-registered factory) and runs against real DeepSeek.
//   Skipped when the registry is empty so CI never accidentally spends tokens.
//
// Writes an eval-results/parts/<suite>.json part file; global-setup.ts merges
// all parts into junit.xml + summary.json, which .github/workflows/
// nightly-evals.yml uploads and diffs against a 7-day baseline for drift.
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { runSkillExtractEvals, SKILL_EXTRACT_FIXTURES } from './index';
import { writeEvalArtifacts } from '../runner';
import type { EvalReport } from '../types';
import type { AIProvider } from '../../provider';
import { ProviderRegistry } from '../../registry';

const LIVE = process.env.EVAL_LIVE === '1';
// Threshold gates from ai-safety.md item 10 (nightly-evals drift):
// aggregate F1 >= 0.85, every fixture individually >= 0.60.
const OVERALL_F1_GATE = 0.85;
const PER_FIXTURE_F1_FLOOR = 0.6;

function resolveLiveProvider(): AIProvider | null {
  // Live mode expects the caller to have registered a factory under 'deepseek'
  // in a global ProviderRegistry set at $CAREEROS_EVAL_REGISTRY, or via the
  // package's own singleton if one has been wired. Keeping this indirection
  // avoids a hard packages/ai -> apps/api coupling.
  const anyReg = (globalThis as { __careerosProviderRegistry?: ProviderRegistry })
    .__careerosProviderRegistry;
  if (!anyReg) return null;
  try {
    return anyReg.resolve('deepseek');
  } catch {
    return null;
  }
}

// Compute once, share across all `it()` cases so we do not re-invoke the
// suite per fixture (either mode is O(fixtures) already).
let suiteResult: Awaited<ReturnType<typeof runSkillExtractEvals>>;

beforeAll(async () => {
  const provider = LIVE ? resolveLiveProvider() : undefined;
  if (LIVE && !provider) {
    console.warn(
      'EVAL_LIVE=1 but no provider registered under globalThis.__careerosProviderRegistry; falling back to mock.',
    );
  }
  suiteResult = await runSkillExtractEvals(
    provider ? { mode: LIVE ? 'live' : 'mock', provider } : { mode: 'mock' },
  );

  // Emit CI artifacts. Best-effort; do not fail the suite on write errors.
  try {
    const report: EvalReport = {
      suite: 'skill-extract',
      promptId: 'job-skill-extract',
      promptVersion: '1.0.0',
      total: suiteResult.overall.total,
      passed: suiteResult.overall.passed,
      meanScore: suiteResult.overall.meanF1,
      cases: suiteResult.results.map((r) => {
        const base = { case: r.fixture.id, pass: r.judge.pass, score: r.judge.f1 };
        return r.judge.notes ? { ...base, detail: r.judge.notes } : base;
      }),
    };
    // Emit to $EVAL_OUT_DIR if set (nightly-evals workflow points this at
    // ./eval-results at the repo root); otherwise fall back to CWD-relative
    // so a bare `pnpm --filter @careeros/ai test:evals` from the repo root
    // still lands the artifact next to the test-results dir.
    const outDir = resolve(process.env.EVAL_OUT_DIR ?? 'eval-results');
    writeEvalArtifacts([report], outDir);
  } catch (err) {
    console.warn('eval artifact emit failed:', err);
  }
});

describe('skill-extract eval suite', () => {
  it('runs all 20+ fixtures', () => {
    expect(SKILL_EXTRACT_FIXTURES.length).toBeGreaterThanOrEqual(20);
    expect(suiteResult.results.length).toBe(SKILL_EXTRACT_FIXTURES.length);
  });

  it(`aggregate F1 meets gate (>= ${OVERALL_F1_GATE})`, () => {
    expect(suiteResult.overall.meanF1).toBeGreaterThanOrEqual(OVERALL_F1_GATE);
  });

  // Per-fixture pass gate. Every fixture must clear PER_FIXTURE_F1_FLOOR
  // individually so a single strong outlier cannot mask a broken domain.
  for (const fixture of SKILL_EXTRACT_FIXTURES) {
    it(`fixture "${fixture.id}" F1 >= ${PER_FIXTURE_F1_FLOOR}`, () => {
      const r = suiteResult.results.find((x) => x.fixture.id === fixture.id);
      expect(r, `no result for fixture ${fixture.id}`).toBeDefined();
      const f1 = r?.judge.f1 ?? 0;
      expect(f1, `${fixture.id}: F1=${f1.toFixed(2)} notes=${r?.judge.notes ?? ''}`).toBeGreaterThanOrEqual(
        PER_FIXTURE_F1_FLOOR,
      );
    });
  }

  it('every tricky fixture excludes its distractor', () => {
    // 'tricky:competitor' fixture mentions Rails but expects it dropped.
    const competitor = suiteResult.results.find(
      (r) => r.fixture.id === 'tricky-competitor-rails-in-js-role',
    );
    expect(competitor).toBeDefined();
    expect(competitor?.output.skillIds.map((s) => s.toLowerCase())).not.toContain('rails');

    // 'tricky:soft-skill' fixture: catalogue has no soft-skill IDs, so
    // 'leadership' / 'communication' must not appear.
    const soft = suiteResult.results.find(
      (r) => r.fixture.id === 'tricky-soft-skill-leadership',
    );
    expect(soft).toBeDefined();
    for (const bad of ['leadership', 'communication', 'mentorship']) {
      expect(soft?.output.skillIds.map((s) => s.toLowerCase())).not.toContain(bad);
    }
  });
});
