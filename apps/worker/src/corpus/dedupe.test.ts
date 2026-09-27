import { describe, expect, it } from 'vitest';
import {
  cosineSim,
  DEFAULT_DUPLICATE_THRESHOLD,
  isNearDuplicate,
  isNearDuplicateByVectors,
} from './dedupe';

describe('cosineSim', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const v = [0.6, 0.8];
    expect(cosineSim(v, v)).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });

  it('returns -1 for anti-parallel vectors', () => {
    expect(cosineSim([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for a zero vector (denominator guard)', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });

  it('is not scale-sensitive: cosine(x, k*x) === 1 for k > 0', () => {
    expect(cosineSim([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 6);
  });

  it('throws on dim mismatch instead of silently truncating', () => {
    expect(() => cosineSim([1, 2], [1, 2, 3])).toThrow(/dim mismatch/);
  });
});

describe('isNearDuplicate', () => {
  it('flags when any neighbour score meets threshold', () => {
    expect(isNearDuplicate([0], [{ score: 0.95 }, { score: 0.5 }])).toBe(true);
  });

  it('rejects when every neighbour is below threshold', () => {
    expect(isNearDuplicate([0], [{ score: 0.9 }, { score: 0.88 }])).toBe(false);
  });

  it('respects a caller-provided threshold', () => {
    expect(isNearDuplicate([0], [{ score: 0.85 }], 0.8)).toBe(true);
    expect(isNearDuplicate([0], [{ score: 0.85 }], 0.9)).toBe(false);
  });

  it('handles an empty neighbour set as not-a-duplicate', () => {
    expect(isNearDuplicate([0], [])).toBe(false);
  });
});

describe('isNearDuplicateByVectors', () => {
  it('flags when any raw vector meets the default cosine threshold', () => {
    const v = [1, 0, 0];
    const near = [0.99, 0.01, 0]; // ~1.0 cosine
    const far = [0, 1, 0];
    expect(isNearDuplicateByVectors(v, [far, near])).toBe(true);
    expect(isNearDuplicateByVectors(v, [far])).toBe(false);
  });
});

describe('DEFAULT_DUPLICATE_THRESHOLD', () => {
  it('is 0.92 (locked-in doc default)', () => {
    // Changing this default is a behaviour-visible tuning knob; the test
    // guards against a drive-by tweak. Update deliberately with a rationale.
    expect(DEFAULT_DUPLICATE_THRESHOLD).toBe(0.92);
  });
});

// MUTATION SMOKE:
//  - Flip `>= threshold` to `> threshold` → the "meets threshold" tests fail.
//  - Remove the denom-guard → the zero-vector test blows up (NaN).
