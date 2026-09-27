import { describe, it } from 'vitest';

describe('matchScoreForJob', () => {
  it('6 scenarios: full/partial/no-user/empty-job/asymmetry/sorted-missing', async () => {
    await import('./match.demo');
  });
});
