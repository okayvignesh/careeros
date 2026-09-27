import { describe, it } from 'vitest';

describe('LLM evals runner (AI-assist / skill-extract scoring)', () => {
  it('4 scenarios: perfect stub 3/3, empty stub 0/3, partial stub, formatReport shape', async () => {
    await import('./evals.demo');
  });
});
