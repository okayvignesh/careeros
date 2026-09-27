import { describe, it } from 'vitest';

describe('knowledge-grader eval suite', () => {
  it('4 scenarios: perfect stub, zero-score stub, formatReport shape, band-scorer catches out-of-band', async () => {
    await import('./knowledge-grader.demo');
  });
});
