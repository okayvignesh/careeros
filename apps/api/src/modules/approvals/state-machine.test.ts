import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATES,
  assertTransition,
  canTransition,
  IllegalStateError,
  isApprovalKind,
  isApprovalState,
  type ApprovalState,
} from './state-machine';

// F.1: full transition matrix. Any edge that's not listed here is illegal.
const LEGAL: Array<[ApprovalState, ApprovalState]> = [
  ['pending', 'approved'],
  ['pending', 'cancelled'],
  ['approved', 'sent'],
  ['approved', 'failed'],
];

describe('approval state machine', () => {
  it('exposes 5 states', () => {
    expect(APPROVAL_STATES).toEqual(['pending', 'approved', 'sent', 'failed', 'cancelled']);
  });

  it('allows every legal transition', () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('rejects every non-legal edge (full matrix)', () => {
    for (const from of APPROVAL_STATES) {
      for (const to of APPROVAL_STATES) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        if (legal) continue;
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(IllegalStateError);
      }
    }
    // MUTATION-SMOKE: add 'sent' to `pending`'s transition list and this
    // matrix scan flips - the illegal edge (pending, sent) starts passing.
  });

  it('rejects self-transitions', () => {
    for (const s of APPROVAL_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('assertTransition throws IllegalStateError with from + to on the error', () => {
    try {
      assertTransition('sent', 'approved');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalStateError);
      expect((err as IllegalStateError).from).toBe('sent');
      expect((err as IllegalStateError).to).toBe('approved');
    }
  });

  it('assertTransition throws when `from` is not a known state', () => {
    expect(() => assertTransition('bogus', 'approved')).toThrow(IllegalStateError);
  });

  it('type guards accept known values and reject unknown', () => {
    expect(isApprovalState('pending')).toBe(true);
    expect(isApprovalState('bogus')).toBe(false);
    expect(isApprovalKind('ats_submit')).toBe(true);
    expect(isApprovalKind('mail_bomb')).toBe(false);
  });
});
