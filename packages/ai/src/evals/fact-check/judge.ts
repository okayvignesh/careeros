// C-P4.7e: F1 judge for fact-check gate evals.
//
// Given a fixture (expected support pattern) and the gate's output (verdict
// Map keyed by claim index), compute precision/recall/F1 on the "supported"
// set. Also expose kept/dropped counts + hallucination rate so a suite report
// can highlight false-positive (kept a fabrication) and false-negative
// (dropped a fact) rates separately.
//
// Formula:
//   supported_expected = fixture.expected.supportedIndices as a Set
//   supported_actual   = { i | verdicts.get(i)?.supported === true }
//   TP = |actual ∩ expected|
//   FP = |actual \ expected|     (claim kept that should have been dropped)
//   FN = |expected \ actual|     (claim dropped that should have been kept)
//   Precision = TP / (TP + FP)
//   Recall    = TP / (TP + FN)
//   F1        = 2 * P * R / (P + R)
//
// Edge cases mirror the skill-extract judge:
//   expected empty + actual empty  → perfect (F1 = 1)
//   expected empty + actual non-empty → false-positive on a no-support fixture
//                                       (F1 = 0, notes fire)
//
// Pass gate: F1 >= 0.75. Drift note when F1 in [0.75, 0.9).

import type { FactCheckFixture } from './fixtures';

export interface Verdict { supported: boolean; reason: string }

export interface JudgeInput {
  /** Verdict map returned by `runFactCheck`. Missing entries treated as false. */
  verdicts: Map<number, Verdict>;
  totalClaims: number;
}

export interface JudgeResult {
  pass: boolean;
  f1: number;
  precision: number;
  recall: number;
  tp: number[];
  fp: number[];
  fn: number[];
  keptCount: number;
  droppedCount: number;
  hallucinationRate: number;
  notes: string | null;
}

export const FACT_CHECK_JUDGE_PASS_F1 = 0.75;
export const FACT_CHECK_JUDGE_DRIFT_F1 = 0.9;

export function judgeFactCheck(actual: JudgeInput, fixture: FactCheckFixture): JudgeResult {
  const expected = new Set(fixture.expected.supportedIndices);
  const supportedActual = new Set<number>();
  for (let i = 0; i < actual.totalClaims; i++) {
    const v = actual.verdicts.get(i);
    if (v?.supported) supportedActual.add(i);
  }

  const tp: number[] = [];
  const fp: number[] = [];
  const fn: number[] = [];
  for (const i of supportedActual) (expected.has(i) ? tp : fp).push(i);
  for (const i of expected) if (!supportedActual.has(i)) fn.push(i);

  const keptCount = supportedActual.size;
  const droppedCount = actual.totalClaims - keptCount;
  const hallucinationRate = actual.totalClaims === 0 ? 0 : droppedCount / actual.totalClaims;

  // Empty-expected edge cases (all-hallucinated + missing-citation-all).
  if (expected.size === 0) {
    // Perfect when actual is also empty; otherwise a spurious keep.
    return {
      pass: supportedActual.size === 0,
      f1: supportedActual.size === 0 ? 1 : 0,
      precision: supportedActual.size === 0 ? 1 : 0,
      recall: 1,
      tp: [],
      fp,
      fn: [],
      keptCount,
      droppedCount,
      hallucinationRate,
      notes:
        supportedActual.size === 0
          ? null
          : `false-positive: kept ${supportedActual.size} claim(s) on an all-hallucinated fixture: ${[...supportedActual].join(', ')}`,
    };
  }

  const precision = supportedActual.size === 0 ? 0 : tp.length / supportedActual.size;
  const recall = tp.length / expected.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let notes: string | null = null;
  if (f1 < FACT_CHECK_JUDGE_PASS_F1) {
    notes = `F1=${f1.toFixed(2)} < ${FACT_CHECK_JUDGE_PASS_F1}; kept-wrong=[${fp.join(',')}] dropped-wrong=[${fn.join(',')}]`;
  } else if (f1 < FACT_CHECK_JUDGE_DRIFT_F1) {
    notes = `drift: F1=${f1.toFixed(2)} < ${FACT_CHECK_JUDGE_DRIFT_F1}`;
  }

  return {
    pass: f1 >= FACT_CHECK_JUDGE_PASS_F1,
    f1,
    precision,
    recall,
    tp,
    fp,
    fn,
    keptCount,
    droppedCount,
    hallucinationRate,
    notes,
  };
}
