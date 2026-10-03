import { describe, expect, it } from 'vitest';
import {
  buildSearchProviders,
  isProviderConfigured,
  SearchProvidersService,
  SEARCH_PROVIDER_WORKLOAD_DEFS,
} from './search-providers.service';

const remotive = { id: 'remotive', name: 'Remotive' };
const firecrawl = { id: 'firecrawl', name: 'Firecrawl' };
const adzuna = { id: 'adzuna', name: 'Adzuna' };

describe('buildSearchProviders', () => {
  it('marks keyless adapters active and key-required adapters standby', () => {
    const out = buildSearchProviders([remotive, firecrawl, adzuna], {}, new Map());
    const by = new Map(out.map((p) => [p.id, p]));
    expect(by.get('remotive')!.status).toBe('active');
    expect(by.get('remotive')!.authNote).toBe('none required');
    expect(by.get('firecrawl')!.status).toBe('standby');
    expect(by.get('firecrawl')!.authNote).toBe('missing FIRECRAWL_API_KEY');
    expect(by.get('adzuna')!.authNote).toBe('missing ADZUNA_APP_ID, ADZUNA_APP_KEY');
  });

  it('flips to active when all required env vars are present', () => {
    const out = buildSearchProviders(
      [firecrawl, adzuna],
      { FIRECRAWL_API_KEY: 'fc-1', ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' },
      new Map(),
    );
    expect(out.every((p) => p.status === 'active')).toBe(true);
    expect(out.find((p) => p.id === 'firecrawl')!.authNote).toBe('credentials configured');
  });

  it('reports declared usage limits and never invents quota/used', () => {
    const [fc] = buildSearchProviders([firecrawl], {}, new Map());
    expect(fc!.host).toBe('api.firecrawl.dev');
    expect(fc!.usage).toContain('Free plan');
    expect(fc!.quota).toBeNull();
    expect(fc!.used).toBeNull();
  });

  it('reads addedAt from the observed sources, including the firecrawl-search alias', () => {
    const map = new Map([['firecrawl-search', '2026-09-01']]);
    const [fc] = buildSearchProviders([firecrawl], {}, map);
    expect(fc!.addedAt).toBe('2026-09-01');
    const [none] = buildSearchProviders([remotive], {}, new Map());
    expect(none!.addedAt).toBeNull();
  });

  it('returns [] for an empty adapter registry', () => {
    expect(buildSearchProviders([], {}, new Map())).toEqual([]);
  });
});

describe('SearchProvidersService', () => {
  function service(rows: Array<{ primarySource: string; _min: { firstSeenAt: Date | null } }>) {
    const prisma = {
      normalizedJob: { groupBy: async () => rows },
    };
    return new SearchProvidersService(prisma as never);
  }

  it('returns a providers envelope and maps first-seen dates', async () => {
    const out = await service([
      { primarySource: 'remotive', _min: { firstSeenAt: new Date('2026-09-20T00:00:00Z') } },
    ]).list({});
    expect(Array.isArray(out.providers)).toBe(true);
    const remotiveRow = out.providers.find((p) => p.id === 'remotive')!;
    expect(remotiveRow.addedAt).toBe('2026-09-20');
  });

  it('handles a null min date without emitting a bogus addedAt', async () => {
    const out = await service([{ primarySource: 'remotive', _min: { firstSeenAt: null } }]).list(
      {},
    );
    expect(out.providers.find((p) => p.id === 'remotive')!.addedAt).toBeNull();
  });

  it('returns workloads only when the backing provider is configured', async () => {
    const unconfigured = await service([]).workloads({});
    expect(unconfigured.workloads).toEqual([]);

    const configured = await service([]).workloads({ FIRECRAWL_API_KEY: 'fc-1' });
    expect(configured.workloads).toEqual(
      [...SEARCH_PROVIDER_WORKLOAD_DEFS].map((d) => ({
        workload: d.workload,
        provider: d.provider,
        schedule: d.schedule,
      })),
    );
    expect(configured.workloads.length).toBeGreaterThan(0);
  });
});

describe('isProviderConfigured', () => {
  it('is true for keyless adapters and false until all required keys exist', () => {
    expect(isProviderConfigured('remotive', {})).toBe(true);
    expect(isProviderConfigured('firecrawl', {})).toBe(false);
    expect(isProviderConfigured('firecrawl', { FIRECRAWL_API_KEY: 'x' })).toBe(true);
    expect(isProviderConfigured('adzuna', { ADZUNA_APP_ID: 'a' })).toBe(false);
    expect(isProviderConfigured('adzuna', { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' })).toBe(true);
  });
});
