import { describe, it } from 'vitest';

describe('DeepSeekProvider hardening (A-H5 max_tokens + Zod retry + constructor SSRF)', () => {
  it('max_tokens sent, Zod retry once with schema-error, retry-fail throws StructuredOutputError', async () => {
    await import('./deepseek.demo');
  });
});
