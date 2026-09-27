import { describe, expect, it } from 'vitest';
import { extent, polylinePoints, trendDirection } from './chart-geometry';

describe('extent', () => {
  it('returns min and max for a varied series', () => {
    const e = extent([3, 1, 9, 4]);
    expect(e.min).toBe(1);
    expect(e.max).toBe(9);
  });

  it('widens a flat series so it does not collapse to a divide-by-zero line', () => {
    // MUTATION-SMOKE: if the `min === max` guard is removed, the sparkline
    // ends up dividing by zero and this expectation goes red.
    const e = extent([5, 5, 5]);
    expect(e.min).toBe(4.5);
    expect(e.max).toBe(5.5);
  });

  it('returns a safe default for an empty series', () => {
    const e = extent([]);
    expect(e).toEqual({ min: 0, max: 1 });
  });
});

describe('polylinePoints', () => {
  it('emits N space-separated x,y pairs for N samples', () => {
    const s = polylinePoints([0, 10], 100, 20);
    // MUTATION-SMOKE: if `step` is off by one, splitting by space yields the
    // wrong count and this assertion goes red.
    expect(s.split(' ')).toHaveLength(2);
    expect(s.split(' ')[0]).toMatch(/^0\.00,/);
    expect(s.split(' ')[1]).toMatch(/^100\.00,/);
  });

  it('inverts y so higher values sit higher on screen', () => {
    // In SVG y=0 is at the top, so the max value should map to a SMALLER y
    // than the min value.
    const [pLow, pHigh] = polylinePoints([1, 10], 100, 100).split(' ');
    const yLow = Number(pLow!.split(',')[1]);
    const yHigh = Number(pHigh!.split(',')[1]);
    expect(yHigh).toBeLessThan(yLow);
  });

  it('returns empty for empty input', () => {
    expect(polylinePoints([], 100, 20)).toBe('');
  });

  it('renders a single point centered horizontally', () => {
    const s = polylinePoints([42], 100, 20);
    expect(s.split(' ')).toHaveLength(1);
    expect(s.split(',')[0]).toBe('50.00');
  });
});

describe('trendDirection', () => {
  it('reads rising when last > first by >5%', () => {
    // MUTATION-SMOKE: if the threshold is dropped to 0, tiny noise reads as
    // "rising" and the steady case below flips.
    expect(trendDirection([100, 110, 120])).toBe('rising');
  });

  it('reads declining when last < first by >5%', () => {
    expect(trendDirection([200, 180, 160])).toBe('declining');
  });

  it('reads steady when the delta is under 5%', () => {
    expect(trendDirection([100, 101, 102])).toBe('steady');
  });

  it('reads steady for a single sample or empty input', () => {
    expect(trendDirection([])).toBe('steady');
    expect(trendDirection([42])).toBe('steady');
  });
});
