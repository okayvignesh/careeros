import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { aggregate, EMPTY_STATE, type Evidence, type EvidenceKind, type EvidenceSignal } from './knowledge-rules';

const KINDS: EvidenceKind[] = ['self', 'document', 'code', 'assessment', 'behavioral', 'outcome'];
const SIGNALS: EvidenceSignal[] = [
  'correct-independent',
  'correct-hinted',
  'partial-correct',
  'incorrect-with-correction',
  'repeated-failure',
  'sustained-application',
  'presence',
];

const evidenceArb: fc.Arbitrary<Evidence> = fc.record({
  kind: fc.constantFrom(...KINDS),
  signal: fc.constantFrom(...SIGNALS),
  observedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2026-09-23') }),
  reasoningQuality: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  streakLength: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
  weightHint: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
}).map((r) => {
  const ev: Evidence = { kind: r.kind, signal: r.signal, observedAt: r.observedAt };
  if (r.reasoningQuality !== undefined) ev.reasoningQuality = r.reasoningQuality;
  if (r.streakLength !== undefined) ev.streakLength = r.streakLength;
  if (r.weightHint !== undefined) ev.weightHint = r.weightHint;
  return ev;
});

describe('aggregate invariants (fast-check)', () => {
  it('proficiency stays in [0, 100] and confidence in [0, 1] for any evidence sequence', () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { maxLength: 40 }), (evs) => {
        const { state } = aggregate(evs, new Date('2026-09-23T00:00:00Z'), EMPTY_STATE);
        return (
          state.proficiency >= 0 &&
          state.proficiency <= 100 &&
          state.confidence >= 0 &&
          state.confidence <= 1 &&
          state.evidenceCount === evs.length
        );
      }),
      { numRuns: 200 },
    );
  });

  it('historicalDemonstrated is monotonic non-decreasing as evidence is appended chronologically', () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { minLength: 1, maxLength: 30 }), (evs) => {
        const sorted = [...evs].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
        let priorHistorical = false;
        for (let i = 1; i <= sorted.length; i++) {
          const { state } = aggregate(sorted.slice(0, i), new Date('2026-09-23T00:00:00Z'));
          if (priorHistorical && !state.historicalDemonstrated) return false;
          priorHistorical = state.historicalDemonstrated;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('aggregate is deterministic — same evidence + same now yields identical state', () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { maxLength: 20 }), (evs) => {
        const now = new Date('2026-09-23T00:00:00Z');
        const a = aggregate(evs, now);
        const b = aggregate(evs, now);
        return JSON.stringify(a.state) === JSON.stringify(b.state);
      }),
      { numRuns: 100 },
    );
  });
});

describe('aggregate sanity', () => {
  it('empty evidence returns EMPTY_STATE plus a rusty ping', () => {
    const { state, events } = aggregate([], new Date('2026-09-23T00:00:00Z'));
    expect(state.evidenceCount).toBe(0);
    expect(state.proficiency).toBe(0);
    expect(events.at(-1)?.rule).toBe('longInactivity');
  });
});
