import { describe, it, expect } from 'vitest';
import { createConfiguredAdapter } from './configured';

describe('createConfiguredAdapter', () => {
  it('returns null when no config is stored, so the caller keeps its default adapter', () => {
    // Regression: previously this built an adapter with empty options, which
    // shadowed the env-reading default (and broke the ingest integration test,
    // whose injected adapter was bypassed).
    expect(createConfiguredAdapter('ashby', { values: {}, secrets: {} })).toBeNull();
    expect(createConfiguredAdapter('firecrawl', { values: {}, secrets: {} })).toBeNull();
    expect(createConfiguredAdapter('adzuna', { values: {}, secrets: {} })).toBeNull();
  });

  it('returns null for an unknown provider even with data', () => {
    expect(createConfiguredAdapter('nope', { values: { a: 'b' }, secrets: {} })).toBeNull();
  });

  it('builds an adapter when at least one value is present', () => {
    const a = createConfiguredAdapter('ashby', { values: { orgIds: 'acme' }, secrets: {} });
    expect(a?.id).toBe('ashby');
  });
});
