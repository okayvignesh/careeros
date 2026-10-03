import { describe, expect, it } from 'vitest';
import { providersView, workloadsView } from './providers-data';

describe('providersView', () => {
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
  };

  it('unwraps the providers envelope and preserves null quota/used', () => {
    const out = providersView({ providers: [provider] });
    expect(out).toHaveLength(1);
    expect(out[0]!.quota).toBeNull();
    expect(out[0]!.used).toBeNull();
  });

  it('keeps an empty result empty (never a fixture)', () => {
    expect(providersView({ providers: [] })).toEqual([]);
  });

  it('throws on a malformed payload', () => {
    expect(() => providersView([provider])).toThrow();
    expect(() => providersView({ providers: [{ id: 'x' }] })).toThrow();
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
