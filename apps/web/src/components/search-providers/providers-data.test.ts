import { describe, expect, it } from 'vitest';
import { providerView, providersView, workloadsView } from './providers-data';

const provider = {
  id: 'firecrawl',
  name: 'Firecrawl',
  host: 'api.firecrawl.dev',
  status: 'active',
  addedAt: '2026-09-01',
  usage: 'Free plan',
  quota: null,
  used: null,
  authNote: 'credentials configured',
  fields: [{ name: 'apiKey', label: 'Firecrawl API key', secret: true, required: true }],
  values: {},
  has: { apiKey: true },
  configured: true,
  missing: [],
};

describe('providersView', () => {
  it('unwraps the providers envelope and preserves null quota/used', () => {
    const out = providersView({ providers: [provider] });
    expect(out).toHaveLength(1);
    expect(out[0]!.quota).toBeNull();
    expect(out[0]!.used).toBeNull();
    expect(out[0]!.has['apiKey']).toBe(true);
    expect(out[0]!.missing).toEqual([]);
  });

  it('keeps an empty result empty (never a fixture)', () => {
    expect(providersView({ providers: [] })).toEqual([]);
  });

  it('throws on a malformed payload', () => {
    expect(() => providersView([provider])).toThrow();
    expect(() => providersView({ providers: [{ id: 'x' }] })).toThrow();
  });
});

describe('providerView', () => {
  it('parses a single provider response', () => {
    expect(providerView(provider).id).toBe('firecrawl');
  });

  it('rejects a provider missing the config fields', () => {
    expect(() => providerView({ id: 'firecrawl', name: 'Firecrawl' })).toThrow();
  });
});

describe('workloadsView', () => {
  it('unwraps the workloads envelope and rejects bad entries', () => {
    expect(
      workloadsView({
        workloads: [{ workload: 'Discovery', provider: 'Firecrawl', schedule: 'every 6 hours' }],
      }),
    ).toHaveLength(1);
    expect(() => workloadsView({ workloads: [{ workload: '' }] })).toThrow();
  });
});
