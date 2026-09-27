import { describe, it } from 'vitest';

describe('wrap (untrusted-content wrapping)', () => {
  it('10 scenarios: closing-tag / opening-tag injection, empty input, determinism, system clause presence, sanitiser', async () => {
    await import('./wrap.demo');
  });
});
