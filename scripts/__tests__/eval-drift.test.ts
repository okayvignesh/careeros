// Unit check for the nightly eval drift calculator. Verifies the regression
// threshold and the no-baseline path without touching GitHub or the filesystem.
import { describe, it, expect } from 'vitest';
import { computeDrift, passRate } from '../eval-drift.mjs';

const summary = (passed: number, total: number) => ({
  overall: { total, passed, meanScore: total === 0 ? 0 : passed / total },
});

describe('computeDrift', () => {
  it('flags a >5pp drop vs the 7-day baseline', () => {
    const current = summary(80, 100); // 0.80
    const baseline = [summary(90, 100), summary(90, 100)]; // 0.90
    const d = computeDrift(current, baseline, 0.05);
    expect(d.baselineRate).toBeCloseTo(0.9, 5);
    expect(d.delta).toBeCloseTo(-0.1, 5);
    expect(d.regressed).toBe(true);
  });

  it('does not flag a drop at or under the threshold', () => {
    const d = computeDrift(summary(86, 100), [summary(90, 100)], 0.05);
    expect(d.regressed).toBe(false);
  });

  it('reports no baseline instead of a false regression', () => {
    const d = computeDrift(summary(50, 100), [], 0.05);
    expect(d.baselineRate).toBeNull();
    expect(d.delta).toBe(0);
    expect(d.regressed).toBe(false);
  });

  it('passRate guards the zero-case summary', () => {
    expect(passRate(summary(0, 0))).toBe(0);
  });
});
