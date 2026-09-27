import { describe, it } from 'vitest';

describe('rubrics (system-design)', () => {
  it('6 scenarios: hash determinism + drift, getRubric known/unknown, gradeAgainstRubric empty/keyword-heavy/overall-formula', async () => {
    await import('./rubrics.demo');
  });
});
