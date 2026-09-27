import { describe, it } from 'vitest';

describe('remotive mapper', () => {
  it('5 scenarios: schema parse, empty-location → null, unparseable date → null, numeric id → string, payload preserved', async () => {
    await import('./remotive.demo');
  });
});
