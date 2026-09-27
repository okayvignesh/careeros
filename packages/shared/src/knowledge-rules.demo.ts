// Runnable self-check for knowledge-rules. Assert-based, no test framework.
// Run: pnpm --filter @careeros/shared exec tsx src/knowledge-rules.demo.ts
import assert from 'node:assert/strict';
import {
  EMPTY_STATE,
  aggregate,
  correctHinted,
  correctIndependent,
  gap,
  incorrectWithCorrection,
  level,
  longInactivity,
  partialCorrect,
  presence,
  repeatedFailure,
  sustainedApplication,
  type Evidence,
} from './knowledge-rules';

const now = new Date('2026-09-23T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

// ---------- rule-by-rule ----------

label('correctIndependent bumps proficiency + confidence + historical', () => {
  const r = correctIndependent(EMPTY_STATE, {
    kind: 'assessment',
    signal: 'correct-independent',
    observedAt: now,
  });
  assert(r.next.proficiency > 0);
  assert(r.next.confidence > 0);
  assert.equal(r.next.historicalDemonstrated, true);
  assert.equal(r.next.evidenceCount, 1);
});

label('correctHinted bumps less than correctIndependent', () => {
  const indep = correctIndependent(EMPTY_STATE, {
    kind: 'assessment',
    signal: 'correct-independent',
    observedAt: now,
  });
  const hinted = correctHinted(EMPTY_STATE, {
    kind: 'assessment',
    signal: 'correct-hinted',
    observedAt: now,
  });
  assert(indep.next.proficiency > hinted.next.proficiency);
});

label('partialCorrect scales by reasoning quality', () => {
  const high = partialCorrect(EMPTY_STATE, {
    kind: 'assessment',
    signal: 'partial-correct',
    reasoningQuality: 1,
    observedAt: now,
  });
  const low = partialCorrect(EMPTY_STATE, {
    kind: 'assessment',
    signal: 'partial-correct',
    reasoningQuality: 0,
    observedAt: now,
  });
  assert(high.next.proficiency > low.next.proficiency);
  assert.equal(low.next.proficiency, 0);
});

label('incorrectWithCorrection leaves proficiency alone, dips confidence', () => {
  const start = { ...EMPTY_STATE, proficiency: 40, confidence: 0.6 };
  const r = incorrectWithCorrection(start, {
    kind: 'assessment',
    signal: 'incorrect-with-correction',
    observedAt: now,
  });
  assert.equal(r.next.proficiency, 40);
  assert(r.next.confidence < start.confidence);
});

label('repeatedFailure lowers confidence proportional to streak length', () => {
  const start = { ...EMPTY_STATE, confidence: 0.7 };
  const short = repeatedFailure(start, {
    kind: 'assessment',
    signal: 'repeated-failure',
    streakLength: 2,
    observedAt: now,
  });
  const long = repeatedFailure(start, {
    kind: 'assessment',
    signal: 'repeated-failure',
    streakLength: 8,
    observedAt: now,
  });
  assert(long.next.confidence < short.next.confidence);
  assert(short.next.confidence < start.confidence);
});

label('sustainedApplication accumulates over streak', () => {
  const start = { ...EMPTY_STATE, proficiency: 10, evidenceCount: 3 };
  const one = sustainedApplication(start, {
    kind: 'code',
    signal: 'sustained-application',
    streakLength: 1,
    observedAt: now,
  });
  const many = sustainedApplication(start, {
    kind: 'code',
    signal: 'sustained-application',
    streakLength: 8,
    observedAt: now,
  });
  assert(many.next.proficiency > one.next.proficiency);
  assert.equal(many.next.historicalDemonstrated, true);
});

label('longInactivity caps confidence but preserves historical proficiency', () => {
  const start = { ...EMPTY_STATE, proficiency: 60, confidence: 0.8, historicalDemonstrated: true };
  const rusty = longInactivity(start, now, daysAgo(365));
  assert.equal(rusty.next.proficiency, 60); // preserved
  assert.equal(rusty.next.historicalDemonstrated, true);
  assert.equal(rusty.next.confidence, 0.25); // capped at the rusty ceiling
});

label('longInactivity is a no-op inside the fresh window', () => {
  const start = { ...EMPTY_STATE, confidence: 0.5 };
  const fresh = longInactivity(start, now, daysAgo(30));
  assert.equal(fresh.next.confidence, 0.5);
});

label('longInactivity is idempotent (does NOT compound on repeated aggregation)', () => {
  // Regression: earlier implementation multiplied confidence by 0.25 every call,
  // so re-aggregating a stale skill collapsed confidence toward zero.
  const start = { ...EMPTY_STATE, proficiency: 60, confidence: 0.8 };
  const once = longInactivity(start, now, daysAgo(365)).next;
  const twice = longInactivity(once, now, daysAgo(365)).next;
  const thrice = longInactivity(twice, now, daysAgo(365)).next;
  assert.equal(once.confidence, twice.confidence);
  assert.equal(twice.confidence, thrice.confidence);
});

label('longInactivity does NOT raise confidence when already below the ceiling', () => {
  const low = { ...EMPTY_STATE, confidence: 0.1 };
  const rusty = longInactivity(low, now, daysAgo(365)).next;
  assert.equal(rusty.confidence, 0.1); // floor-cap only lowers, never lifts
});

label('presence records a claim but does NOT award proficiency or historical', () => {
  // Regression: earlier implementation routed presence through correctHinted and
  // gave ~+0.96 proficiency per resume mention.
  const start = { ...EMPTY_STATE, proficiency: 12, historicalDemonstrated: false };
  const r = presence(start, { kind: 'self', signal: 'presence', observedAt: now });
  assert.equal(r.next.proficiency, 12);
  assert.equal(r.next.historicalDemonstrated, false);
  assert.equal(r.next.evidenceCount, start.evidenceCount + 1);
});

// ---------- level + gap ----------

label('level is 1 with no evidence', () => {
  assert.equal(level(EMPTY_STATE), 1);
});

label('level rewards evidence count but does not overshoot proficiency by miles', () => {
  const small = { ...EMPTY_STATE, proficiency: 60, confidence: 0.8, evidenceCount: 1 };
  const many = { ...EMPTY_STATE, proficiency: 60, confidence: 0.8, evidenceCount: 40 };
  assert(level(many) > level(small));
  assert(level(many) <= 100);
});

label('gap turns positive when below threshold, negative when above', () => {
  const weak = { ...EMPTY_STATE, proficiency: 20, confidence: 0.4, evidenceCount: 2 };
  const strong = { ...EMPTY_STATE, proficiency: 80, confidence: 0.9, evidenceCount: 12 };
  assert(gap(weak, 60) > 0);
  assert(gap(strong, 40) < 0);
});

// ---------- aggregator end-to-end ----------

label('aggregate folds evidence in chronological order', () => {
  const evs: Evidence[] = [
    { kind: 'assessment', signal: 'correct-independent', observedAt: daysAgo(60) },
    { kind: 'code', signal: 'sustained-application', streakLength: 4, observedAt: daysAgo(30) },
    { kind: 'assessment', signal: 'correct-hinted', observedAt: daysAgo(10) },
  ];
  const { state, events } = aggregate(evs, now);
  assert.equal(state.evidenceCount, 3);
  assert(state.proficiency > 0);
  assert.equal(state.historicalDemonstrated, true);
  // 3 rules + 1 longInactivity ping.
  assert.equal(events.length, 4);
  assert.equal(events[events.length - 1]!.rule, 'longInactivity');
});

label('aggregate marks rusty when latest evidence is >180 days old', () => {
  const evs: Evidence[] = [
    { kind: 'assessment', signal: 'correct-independent', observedAt: daysAgo(400) },
  ];
  const { state } = aggregate(evs, now);
  assert(state.historicalDemonstrated);
  assert.equal(state.confidence, 0.08); // capped at RUSTY_CONFIDENCE_CEILING (0.25) but was only 0.08
  assert(state.recencyDays >= 180);
});

label('aggregate on empty evidence returns EMPTY_STATE + rusty ping only', () => {
  const { state, events } = aggregate([], now);
  assert.equal(state.evidenceCount, 0);
  assert.equal(state.proficiency, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.rule, 'longInactivity');
});

// eslint-disable-next-line no-console
console.log('\nall knowledge-rules checks passed');
