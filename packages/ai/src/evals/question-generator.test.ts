import { describe, it } from 'vitest';

describe('question-generator eval suite', () => {
  it('4 scenarios: perfect stub (8/8), schema-invalid, wrong-topic, formatReport shape', async () => {
    await import('./question-generator.demo');
  });
});
