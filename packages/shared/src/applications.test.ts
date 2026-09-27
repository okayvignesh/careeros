import { describe, it } from 'vitest';

describe('application state machine', () => {
  it('6 scenarios: allowed forward transitions, ghosted branch, no-skip, terminal absorbing, same-state rejected', async () => {
    await import('./applications.demo');
  });
});
