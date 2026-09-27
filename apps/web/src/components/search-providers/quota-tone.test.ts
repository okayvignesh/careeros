import { describe, expect, it } from 'vitest';
import { quotaShare, quotaTone } from './quota-tone';

describe('quotaTone', () => {
  it('returns default under 70%, warn from 70-89%, danger from 90%+', () => {
    // MUTATION-SMOKE: if either threshold is dropped by 0.1 the boundary
    // cases below flip buckets.
    expect(quotaTone(0, 100)).toBe('default');
    expect(quotaTone(69, 100)).toBe('default');
    expect(quotaTone(70, 100)).toBe('warn');
    expect(quotaTone(89, 100)).toBe('warn');
    expect(quotaTone(90, 100)).toBe('danger');
    expect(quotaTone(100, 100)).toBe('danger');
  });

  it('treats a zero or negative quota as unmetered (default tone)', () => {
    // Guards against divide-by-zero and a provider that reports no cap.
    expect(quotaTone(500, 0)).toBe('default');
    expect(quotaTone(500, -1)).toBe('default');
  });
});

describe('quotaShare', () => {
  it('returns a clamped 0..1 ratio', () => {
    expect(quotaShare(50, 100)).toBe(0.5);
    // MUTATION-SMOKE: without the clamp, over-quota reports > 1 and the bar
    // renders past its container.
    expect(quotaShare(150, 100)).toBe(1);
    expect(quotaShare(-10, 100)).toBe(0);
    expect(quotaShare(10, 0)).toBe(0);
  });
});
