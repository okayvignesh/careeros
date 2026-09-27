// Runnable self-check for application state machine.
import assert from 'node:assert/strict';
import { canTransition, nextStatesFrom, TERMINAL_STATES } from './applications';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

label('interested → applied is allowed', () => {
  assert.equal(canTransition('interested', 'applied'), true);
});

label('applied → interviewing is allowed', () => {
  assert.equal(canTransition('applied', 'interviewing'), true);
});

label('any state → ghosted allowed except from terminal', () => {
  assert.equal(canTransition('interested', 'ghosted'), true);
  assert.equal(canTransition('applied', 'ghosted'), true);
  assert.equal(canTransition('interviewing', 'ghosted'), true);
  assert.equal(canTransition('offer', 'ghosted'), false);
  assert.equal(canTransition('rejected', 'ghosted'), false);
});

label('cannot skip states (interested → interviewing rejected)', () => {
  assert.equal(canTransition('interested', 'interviewing'), false);
  assert.equal(canTransition('interested', 'offer'), false);
});

label('terminal states are absorbing (no outbound transitions)', () => {
  for (const term of TERMINAL_STATES) {
    assert.deepEqual(nextStatesFrom(term), []);
  }
});

label('same-state transition rejected', () => {
  assert.equal(canTransition('interested', 'interested'), false);
  assert.equal(canTransition('applied', 'applied'), false);
});

// eslint-disable-next-line no-console
console.log('\nall application state-machine checks passed');
