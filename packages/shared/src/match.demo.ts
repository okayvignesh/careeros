// Runnable self-check for match scoring. Assert-based, no framework.
import assert from 'node:assert/strict';
import { matchScoreForJob } from './match';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

label('full coverage → score 1.0', () => {
  const r = matchScoreForJob(['ts', 'react', 'nodejs'], ['ts', 'react']);
  assert.equal(r.score, 1);
  assert.equal(r.matched, 2);
  assert.equal(r.total, 2);
  assert.deepEqual(r.missing, []);
});

label('partial coverage → matched / total', () => {
  const r = matchScoreForJob(['ts'], ['ts', 'react', 'nodejs']);
  assert.equal(r.matched, 1);
  assert.equal(r.total, 3);
  assert(Math.abs(r.score! - 1 / 3) < 1e-9);
  assert.deepEqual(r.missing, ['nodejs', 'react']);
});

label('no user skills → 0%, all missing', () => {
  const r = matchScoreForJob([], ['ts', 'react']);
  assert.equal(r.score, 0);
  assert.equal(r.matched, 0);
  assert.deepEqual(r.missing, ['react', 'ts']);
});

label('empty job skills → null (extraction pending or nothing matched)', () => {
  const r = matchScoreForJob(['ts', 'react', 'nodejs'], []);
  assert.equal(r.score, null);
  assert.equal(r.matched, 0);
  assert.equal(r.total, 0);
});

label('score is not symmetric: extra user breadth does not hurt', () => {
  const a = matchScoreForJob(['ts', 'react'], ['ts', 'react']);
  const b = matchScoreForJob(['ts', 'react', 'python', 'go', 'rust'], ['ts', 'react']);
  assert.equal(a.score, b.score);
  assert.equal(a.score, 1);
});

label('missing is sorted for stable UI ordering', () => {
  const r = matchScoreForJob([], ['zebra', 'apple', 'monkey']);
  assert.deepEqual(r.missing, ['apple', 'monkey', 'zebra']);
});

// eslint-disable-next-line no-console
console.log('\nall match-score checks passed');
