import { describe, it } from 'vitest';

describe('parseSystemDesignPrimer', () => {
  it('10 scenarios: bullet-only extraction, link stripping, default skill, dedupe, non-question skip, prose skip, length filter, empty input, starter-word match, non-question-non-starter skip', async () => {
    await import('./system-design-primer.demo');
  });
});
