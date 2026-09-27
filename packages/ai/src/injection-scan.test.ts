import { describe, it } from 'vitest';

describe('injection-scan (A-H5 prompt-injection detection + wrapUntrusted)', () => {
  it('unicode-tag positive, zero-width positive, clean-English negative, blocked throws', async () => {
    await import('./injection-scan.demo');
  });
});
