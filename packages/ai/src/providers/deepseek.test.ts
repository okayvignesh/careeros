import { describe, it } from 'vitest';

describe('DeepSeekProvider hardening (A-H5 + A-L1)', () => {
  it('max_tokens, Zod retry, StructuredOutputError, LLMProviderError hides upstream', async () => {
    await import('./deepseek.demo');
  });
});
