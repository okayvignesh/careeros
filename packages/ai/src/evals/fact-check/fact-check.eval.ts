// C-P4.7e: real vitest eval for the fact-check gate.
//
// EVAL_MOCK=1 (default): mock provider emits fixture-expected verdicts;
//   every fixture asserts judge passes and hallucination rate matches.
// EVAL_LIVE=1: real DeepSeek via a caller-registered ProviderRegistry
//   (mirrors skill-extract.eval.ts pattern).
//
// Writes an eval-results/parts/<suite>.json part file when EVAL_OUT_DIR is set;
// global-setup.ts merges all parts into junit.xml + summary.json for the
// nightly-evals workflow to upload and diff against the 7-day baseline.
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import {
  FACT_CHECK_FIXTURES,
  runFactCheckEvals,
  type FactCheckSuiteResult,
} from './index';
import { writeEvalArtifacts } from '../runner';
import type { EvalReport } from '../types';
import type { AIProvider } from '../../provider';
import { ProviderRegistry } from '../../registry';

const LIVE = process.env.EVAL_LIVE === '1';
// Thresholds mirror ai-safety.md item 10: aggregate F1 >= 0.85, every
// fixture >= 0.60 individually so an outlier can't launder a broken domain.
const OVERALL_F1_GATE = 0.85;
const PER_FIXTURE_F1_FLOOR = 0.6;

function resolveLiveProvider(): AIProvider | null {
  const anyReg = (globalThis as { __careerosProviderRegistry?: ProviderRegistry })
    .__careerosProviderRegistry;
  if (!anyReg) return null;
  try {
    return anyReg.resolve('deepseek');
  } catch {
    return null;
  }
}

let suiteResult: FactCheckSuiteResult;

beforeAll(async () => {
  const provider = LIVE ? resolveLiveProvider() : undefined;
  if (LIVE && !provider) {
    console.warn(
      'EVAL_LIVE=1 but no provider registered under globalThis.__careerosProviderRegistry; falling back to mock.',
    );
  }
  suiteResult = await runFactCheckEvals(
    provider ? { mode: LIVE ? 'live' : 'mock', provider } : { mode: 'mock' },
  );

  try {
    const report: EvalReport = {
      suite: 'fact-check',
      promptId: 'resume-bullet-fact-check',
      promptVersion: '1.0.0',
      total: suiteResult.overall.total,
      passed: suiteResult.overall.passed,
      meanScore: suiteResult.overall.meanF1,
      cases: suiteResult.results.map((r) => {
        const base = { case: r.fixture.id, pass: r.judge.pass, score: r.judge.f1 };
        return r.judge.notes ? { ...base, detail: r.judge.notes } : base;
      }),
    };
    const outDir = resolve(process.env.EVAL_OUT_DIR ?? 'eval-results');
    writeEvalArtifacts([report], outDir);
  } catch (err) {
    console.warn('fact-check eval artifact emit failed:', err);
  }
});

describe('fact-check gate eval suite', () => {
  it('runs all 15+ fixtures', () => {
    expect(FACT_CHECK_FIXTURES.length).toBeGreaterThanOrEqual(15);
    expect(suiteResult.results.length).toBe(FACT_CHECK_FIXTURES.length);
  });

  it(`aggregate F1 meets gate (>= ${OVERALL_F1_GATE})`, () => {
    expect(suiteResult.overall.meanF1).toBeGreaterThanOrEqual(OVERALL_F1_GATE);
  });

  for (const fixture of FACT_CHECK_FIXTURES) {
    it(`fixture "${fixture.id}" F1 >= ${PER_FIXTURE_F1_FLOOR}`, () => {
      const r = suiteResult.results.find((x) => x.fixture.id === fixture.id);
      expect(r, `no result for fixture ${fixture.id}`).toBeDefined();
      const f1 = r?.judge.f1 ?? 0;
      expect(
        f1,
        `${fixture.id}: F1=${f1.toFixed(2)} notes=${r?.judge.notes ?? ''}`,
      ).toBeGreaterThanOrEqual(PER_FIXTURE_F1_FLOOR);
    });

    it(`fixture "${fixture.id}" kept/dropped counts match expected`, () => {
      const r = suiteResult.results.find((x) => x.fixture.id === fixture.id);
      expect(r).toBeDefined();
      expect(r?.judge.keptCount).toBe(fixture.expected.keptCount);
      expect(r?.judge.droppedCount).toBe(fixture.expected.droppedCount);
      // Hallucination-rate parity: mock is deterministic, live is best-effort
      // (skip parity when LIVE is set — the F1 gate above still enforces).
      if (!LIVE) {
        expect(r?.judge.hallucinationRate).toBeCloseTo(fixture.expected.hallucinationRate, 5);
      }
    });
  }

  it('every all-hallucinated fixture kept zero claims', () => {
    for (const r of suiteResult.results.filter((x) => x.fixture.category === 'all-hallucinated')) {
      expect(r.judge.keptCount).toBe(0);
    }
  });

  it('every all-supported fixture kept every claim', () => {
    for (const r of suiteResult.results.filter((x) => x.fixture.category === 'all-supported')) {
      expect(r.judge.keptCount).toBe(r.fixture.claims.length);
    }
  });
});
