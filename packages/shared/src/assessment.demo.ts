// Runnable self-check for assessment. Assert-based, no framework.
// Run: pnpm --filter @careeros/shared exec tsx src/assessment.demo.ts
import assert from 'node:assert/strict';
import {
  gradeCodeReview,
  gradeDebugging,
  gradeKnowledge,
  gradeMockInterview,
  shouldRemediate,
  xpLevel,
  newStreak,
  streakTick,
  xpFor,
  type RemediationInput,
} from './assessment';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

// ---------- xpFor ----------

label('xpFor scales linearly with score, rounds to int', () => {
  assert.equal(xpFor('knowledge', 1), 50);
  assert.equal(xpFor('knowledge', 0.5), 25);
  assert.equal(xpFor('knowledge', 0), 0);
});

label('xpFor clamps score to [0,1]', () => {
  assert.equal(xpFor('knowledge', -1), 0);
  assert.equal(xpFor('knowledge', 2), 50);
});

label('xpFor uses per-kind base', () => {
  assert.equal(xpFor('coding-easy', 1), 100);
  assert.equal(xpFor('coding-hard', 1), 400);
  assert.equal(xpFor('boss-battle', 1), 1000);
});

// ---------- level ----------

label('level 1 at zero XP', () => {
  const info = xpLevel(0);
  assert.equal(info.level, 1);
  assert.equal(info.xpInLevel, 0);
});

label('level advances as XP grows', () => {
  const lo = xpLevel(50);
  const hi = xpLevel(50_000);
  assert(hi.level > lo.level);
  assert(hi.level <= 100);
});

// ---------- streaks ----------

label('first attempt sets currentDays=1, longestDays=1', () => {
  const s0 = newStreak(day('2026-09-24'));
  const s1 = streakTick(s0, day('2026-09-24'));
  assert.equal(s1.currentDays, 1);
  assert.equal(s1.longestDays, 1);
});

label('same-day second attempt does NOT bump streak', () => {
  const s0 = newStreak(day('2026-09-24'));
  const a = streakTick(s0, day('2026-09-24'));
  const b = streakTick(a, day('2026-09-24'));
  assert.equal(a.currentDays, b.currentDays);
});

label('next-day attempt bumps to 2', () => {
  const s0 = newStreak(day('2026-09-24'));
  const a = streakTick(s0, day('2026-09-24'));
  const b = streakTick(a, day('2026-09-25'));
  assert.equal(b.currentDays, 2);
  assert.equal(b.longestDays, 2);
});

label('single-day gap consumed by grace, streak keeps advancing', () => {
  const s0 = newStreak(day('2026-09-24'));
  const a = streakTick(s0, day('2026-09-24'));
  // Skip the 25th; return on the 26th (gap = 1 day). Grace covers it.
  const b = streakTick(a, day('2026-09-26'));
  assert.equal(b.currentDays, 2);
  assert.equal(b.graceRemaining, 1);
});

label('gap larger than grace resets streak to 1', () => {
  const s0 = newStreak(day('2026-09-24'));
  const a = streakTick(s0, day('2026-09-24'));
  // 5-day gap; only 2 grace days available.
  const b = streakTick(a, day('2026-09-30'));
  assert.equal(b.currentDays, 1);
  assert.equal(b.longestDays, 1); // preserved
});

label('grace pool refills at start of next month', () => {
  const s0 = newStreak(day('2026-09-24'));
  const a = streakTick(s0, day('2026-09-24'));
  // Consume both grace days across September gaps.
  const b = streakTick({ ...a, graceRemaining: 0 }, day('2026-10-05'));
  // Even though grace was 0 at time of tick, October reset restored it BEFORE
  // the reset check; hence a large gap after refill still resets.
  assert.equal(b.graceRemaining, 2);
});

// ---------- gradeKnowledge ----------

label('gradeKnowledge scores by keyPoint hits', () => {
  const r = gradeKnowledge('React uses a virtual DOM and reconciler.', [
    'virtual DOM',
    'reconciler',
    'fiber',
  ]);
  assert.equal(r.hits.length, 2);
  assert.equal(r.misses.length, 1);
  assert(Math.abs(r.score - 2 / 3) < 1e-9);
});

label('gradeKnowledge scores 0 with no keyPoints and flags the question', () => {
  const r = gradeKnowledge('anything', []);
  assert.equal(r.score, 0);
  assert(r.reasoning.toLowerCase().includes('regenerate'));
});

// ---------- shouldRemediate ----------

const now = day('2026-09-25');
const daysAgo = (n: number, score: number): RemediationInput => ({
  score,
  createdAt: new Date(now.getTime() - n * 86_400_000),
});

label('shouldRemediate opens after 3 consecutive recent fails', () => {
  const r = shouldRemediate(
    [daysAgo(1, 0.2), daysAgo(3, 0.1), daysAgo(5, 0.4)],
    now,
  );
  assert.equal(r.shouldOpen, true);
  assert.equal(r.consecutiveFails, 3);
});

label('shouldRemediate does NOT open with only 2 fails', () => {
  const r = shouldRemediate([daysAgo(1, 0.2), daysAgo(3, 0.3)], now);
  assert.equal(r.shouldOpen, false);
  assert.equal(r.consecutiveFails, 2);
});

label('shouldRemediate: a pass in-between breaks the streak', () => {
  const r = shouldRemediate(
    [daysAgo(1, 0.2), daysAgo(3, 0.9), daysAgo(5, 0.2), daysAgo(7, 0.1)],
    now,
  );
  // Newest-first walk: 0.2, then 0.9 breaks the streak at count=1.
  assert.equal(r.shouldOpen, false);
  assert.equal(r.consecutiveFails, 1);
});

label('shouldRemediate: old fails outside the 14d window are ignored', () => {
  const r = shouldRemediate(
    [daysAgo(30, 0.1), daysAgo(45, 0.1), daysAgo(60, 0.1)],
    now,
  );
  assert.equal(r.shouldOpen, false);
  assert.equal(r.consecutiveFails, 0);
});

label('shouldRemediate: empty attempts returns no-op', () => {
  const r = shouldRemediate([], now);
  assert.equal(r.shouldOpen, false);
  assert.equal(r.triggeringAttempts.length, 0);
});

// ---------- gradeCodeReview ----------

label('gradeCodeReview: perfect coverage scores 1.0', () => {
  const r = gradeCodeReview(
    ['off-by-one loop bound', 'missing null check on user'],
    ['off-by-one loop bound', 'missing null check on user'],
  );
  assert.equal(r.hits.length, 2);
  assert.equal(r.misses.length, 0);
  assert.equal(r.score, 1);
});

label('gradeCodeReview: paraphrase still matches when tokens overlap', () => {
  const r = gradeCodeReview(
    ['user parameter is not null-checked'],
    ['missing null check on user parameter'],
  );
  assert.equal(r.hits.length, 1);
  assert(r.score > 0);
});

label('gradeCodeReview: false positives hurt precision, not recall', () => {
  const r = gradeCodeReview(
    ['off-by-one loop bound', 'random unrelated nonsense qwerty'],
    ['off-by-one loop bound'],
  );
  assert.equal(r.recall, 1);
  assert(r.precision < 1);
  assert.equal(r.falsePositives.length, 1);
});

label('gradeCodeReview: no findings → score 0, all defects missed', () => {
  const r = gradeCodeReview([], ['off-by-one loop bound']);
  assert.equal(r.score, 0);
  assert.equal(r.misses.length, 1);
});

label('gradeCodeReview: no defects flags the task for regeneration', () => {
  const r = gradeCodeReview(['whatever'], []);
  assert.equal(r.score, 0);
  assert(r.reasoning.toLowerCase().includes('regenerate'));
});

// ---------- gradeDebugging ----------

label('gradeDebugging: empty fix scores 0', () => {
  const r = gradeDebugging('function add(a, b) { return a - b; }', '', 'wrong operator subtracts instead of adds');
  assert.equal(r.score, 0);
  assert.equal(r.correctness, 0);
});

label('gradeDebugging: fix that touches root-cause vocab scores > 0', () => {
  const broken = 'function add(a, b) { return a - b; }';
  const fix = 'function add(a, b) { return a + b; }';
  const rootCause = 'wrong operator subtracts instead of adds should use plus operator';
  const r = gradeDebugging(broken, fix, rootCause);
  assert(r.correctness > 0);
  assert(r.score > 0);
});

label('gradeDebugging: unrelated churn hurts minimality', () => {
  const broken = 'function add(a, b) { return a - b; }';
  const bigChurn = 'function add(a, b) { const x = 1; const y = 2; const z = 3; return a - b + x - x + y - y + z - z; }';
  const r = gradeDebugging(broken, bigChurn, 'wrong operator');
  assert(r.minimality < 1);
});

label('gradeDebugging: identical output = maximal minimality, zero correctness', () => {
  const broken = 'return a - b';
  const r = gradeDebugging(broken, broken, 'wrong operator subtracts');
  assert.equal(r.minimality, 1);
  assert.equal(r.correctness, 0);
});

// ---------- gradeMockInterview ----------

label('gradeMockInterview: perfect coverage per Q → overall 1.0', () => {
  const questions = [
    { keyPoints: ['virtual DOM', 'reconciler'] },
    { keyPoints: ['event loop', 'single-threaded'] },
    { keyPoints: ['ownership', 'trade-off'] },
  ];
  const answers = [
    'virtual DOM diff via reconciler',
    'event loop is single-threaded',
    'ownership and trade-off matter',
  ];
  const r = gradeMockInterview(answers, questions);
  assert.equal(r.score, 1);
  assert.equal(r.questions.length, 3);
});

label('gradeMockInterview: mixed hit rate averages sensibly', () => {
  const questions = [
    { keyPoints: ['a', 'b'] },
    { keyPoints: ['c', 'd'] },
    { keyPoints: ['e', 'f'] },
  ];
  const r = gradeMockInterview(['a', '', 'e f'], questions);
  // 0.5 + 0 + 1.0 = 1.5 / 3 = 0.5
  assert(Math.abs(r.score - 0.5) < 1e-9);
});

label('gradeMockInterview: wrong shape returns malformed grade', () => {
  const r = gradeMockInterview(['only one'], [{ keyPoints: ['a'] }]);
  assert.equal(r.score, 0);
  assert(r.reasoning.toLowerCase().includes('malformed'));
});

// eslint-disable-next-line no-console
console.log('\nall assessment checks passed');
