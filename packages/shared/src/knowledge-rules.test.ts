import { describe, it } from 'vitest';

// The .demo.ts file executes 14 assert-based scenarios at import time.
// Importing it here gives Vitest a signal (any failed assert throws) and keeps
// the demo runnable standalone via `pnpm exec tsx src/knowledge-rules.demo.ts`.
describe('knowledge-rules', () => {
  it('all 14 scenarios (correctIndependent, correctHinted, partialCorrect, incorrectWithCorrection, repeatedFailure, sustainedApplication, longInactivity, presence, level, gap, aggregate x3)', async () => {
    await import('./knowledge-rules.demo');
  });
});
