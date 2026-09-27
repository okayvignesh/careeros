// C-P4.7e: unit test for the fact-check judge. Kept in the regular vitest
// glob so a broken judge blocks merge without needing the eval CI job.
import { describe, expect, it } from 'vitest';
import { judgeFactCheck, FACT_CHECK_JUDGE_PASS_F1 } from './judge';
import type { FactCheckFixture } from './fixtures';

const fixture = (
  supportedIndices: number[],
  totalClaims: number,
): FactCheckFixture => ({
  id: `fix-${supportedIndices.join('-')}-of-${totalClaims}`,
  category: 'mixed',
  factBase: [],
  claims: Array.from({ length: totalClaims }, (_, i) => ({ text: `c${i}`, factRefs: [] })),
  expected: {
    keptCount: supportedIndices.length,
    droppedCount: totalClaims - supportedIndices.length,
    hallucinationRate: (totalClaims - supportedIndices.length) / (totalClaims || 1),
    supportedIndices,
  },
});

function verdicts(entries: Array<[number, boolean]>): Map<number, { supported: boolean; reason: string }> {
  return new Map(entries.map(([i, s]) => [i, { supported: s, reason: '' }]));
}

describe('judgeFactCheck', () => {
  it('perfect verdict matches expected → F1 = 1, precision = 1, recall = 1', () => {
    const r = judgeFactCheck(
      { verdicts: verdicts([[0, true], [1, true]]), totalClaims: 2 },
      fixture([0, 1], 2),
    );
    expect(r.f1).toBe(1);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.pass).toBe(true);
    expect(r.tp.sort()).toEqual([0, 1]);
    expect(r.fp).toEqual([]);
    expect(r.fn).toEqual([]);
  });

  it('false-positive kept (auditor missed a fabrication) → precision penalised', () => {
    const r = judgeFactCheck(
      // Actual: kept 0 AND 1. Expected: only 0 supported.
      { verdicts: verdicts([[0, true], [1, true]]), totalClaims: 2 },
      fixture([0], 2),
    );
    expect(r.tp).toEqual([0]);
    expect(r.fp).toEqual([1]);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo((2 * 0.5 * 1) / (0.5 + 1), 5);
  });

  it('false-negative dropped (auditor tossed a fact) → recall penalised', () => {
    const r = judgeFactCheck(
      // Actual: kept 0 only. Expected: 0 AND 1 supported.
      { verdicts: verdicts([[0, true], [1, false]]), totalClaims: 2 },
      fixture([0, 1], 2),
    );
    expect(r.tp).toEqual([0]);
    expect(r.fp).toEqual([]);
    expect(r.fn).toEqual([1]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0.5);
  });

  it('all-hallucinated fixture: kept nothing → F1 = 1', () => {
    const r = judgeFactCheck(
      { verdicts: verdicts([[0, false], [1, false]]), totalClaims: 2 },
      fixture([], 2),
    );
    expect(r.pass).toBe(true);
    expect(r.f1).toBe(1);
    expect(r.keptCount).toBe(0);
    expect(r.droppedCount).toBe(2);
    expect(r.hallucinationRate).toBe(1);
  });

  it('all-hallucinated fixture but auditor kept one → hard fail with named note', () => {
    const r = judgeFactCheck(
      { verdicts: verdicts([[0, true], [1, false]]), totalClaims: 2 },
      fixture([], 2),
    );
    expect(r.pass).toBe(false);
    expect(r.f1).toBe(0);
    expect(r.notes).toContain('false-positive');
  });

  it('missing-verdict = dropped in the counts (matches gate behaviour)', () => {
    // No verdict for index 1 at all → not in map → dropped.
    const r = judgeFactCheck(
      { verdicts: verdicts([[0, true]]), totalClaims: 2 },
      fixture([0], 2),
    );
    expect(r.keptCount).toBe(1);
    expect(r.droppedCount).toBe(1);
    expect(r.pass).toBe(true); // Judge cares about the supported-set, not raw counts.
  });

  it('pass gate threshold is exposed as a constant', () => {
    expect(FACT_CHECK_JUDGE_PASS_F1).toBeGreaterThan(0);
    expect(FACT_CHECK_JUDGE_PASS_F1).toBeLessThan(1);
  });
});
