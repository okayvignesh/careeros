import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, rateLimitFor } from './rate-limits';

describe('RATE_LIMITS', () => {
  it('declares ceilings for the job-source adapters', () => {
    expect(RATE_LIMITS.firecrawl.callsPerMinute).toBeGreaterThan(0);
    expect(RATE_LIMITS.workday.callsPerMinute).toBeGreaterThan(0);
    expect(RATE_LIMITS.greenhouse.callsPerMinute).toBeGreaterThan(0);
    expect(RATE_LIMITS.adzuna.callsPerDay).toBe(25);
  });

  it('rateLimitFor resolves known providers and returns undefined otherwise', () => {
    expect(rateLimitFor('firecrawl')).toBe(RATE_LIMITS.firecrawl);
    expect(rateLimitFor('unknown-provider')).toBeUndefined();
  });
});
