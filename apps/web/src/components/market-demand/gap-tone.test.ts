import { describe, expect, it } from 'vitest';
import { gapLabel, gapTone } from './gap-tone';

describe('gapTone', () => {
  it('returns met when the market threshold is already covered', () => {
    // MUTATION-SMOKE: if the `<= 0` branch flips to `< 0`, a zero gap is
    // miscategorised and this expectation flips too.
    expect(gapTone(0)).toBe('met');
    expect(gapTone(-4)).toBe('met');
  });

  it('scales through default → warn → danger as the gap widens', () => {
    expect(gapTone(5)).toBe('default');
    expect(gapTone(14)).toBe('default');
    expect(gapTone(15)).toBe('warn');
    expect(gapTone(29)).toBe('warn');
    expect(gapTone(30)).toBe('danger');
    expect(gapTone(120)).toBe('danger');
  });
});

describe('gapLabel', () => {
  it('reads Met when the gap is covered, otherwise Gap N', () => {
    expect(gapLabel(0)).toBe('Met');
    expect(gapLabel(-3)).toBe('Met');
    expect(gapLabel(24)).toBe('Gap 24');
  });
});
