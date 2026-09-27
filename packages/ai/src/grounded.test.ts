import { describe, it } from 'vitest';

describe('grounded generation contract', () => {
  it('7 scenarios: fabricated names/years flagged, faithful stub clean, hook-fires on suspects', async () => {
    await import('./grounded.demo');
  });
});
