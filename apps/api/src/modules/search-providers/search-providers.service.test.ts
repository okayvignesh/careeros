import { describe, expect, it, vi } from 'vitest';
import { resolveProviderConfig, type ProviderConfigView } from '@careeros/shared';
import {
  buildSearchProviders,
  isProviderConfigured,
  SearchProvidersService,
  SEARCH_PROVIDER_WORKLOAD_DEFS,
} from './search-providers.service';

const remotive = { id: 'remotive', name: 'Remotive' };
const firecrawl = { id: 'firecrawl', name: 'Firecrawl' };
const adzuna = { id: 'adzuna', name: 'Adzuna' };

function view(id: string, stored: Parameters<typeof resolveProviderConfig>[1], env = {}): ProviderConfigView {
  return resolveProviderConfig(id, stored, env);
}

describe('buildSearchProviders', () => {
  it('marks keyless adapters active and key-required adapters standby', () => {
    const out = buildSearchProviders([remotive, firecrawl, adzuna], new Map(), new Map());
    const by = new Map(out.map((p) => [p.id, p]));
    expect(by.get('remotive')!.status).toBe('active');
    expect(by.get('remotive')!.authNote).toBe('none required');
    expect(by.get('firecrawl')!.status).toBe('standby');
    expect(by.get('firecrawl')!.authNote).toBe('missing apiKey');
    expect(by.get('adzuna')!.authNote).toBe('missing appId, appKey');
  });

  it('flips to active when the config (DB or env fallback) has all required fields', () => {
    const views = new Map<string, ProviderConfigView>([
      ['firecrawl', view('firecrawl', { values: {}, secrets: { apiKey: 'enc:v1:x' } })],
      ['adzuna', view('adzuna', null, { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' })],
    ]);
    const out = buildSearchProviders([firecrawl, adzuna], views, new Map());
    expect(out.every((p) => p.status === 'active')).toBe(true);
    expect(out.find((p) => p.id === 'firecrawl')!.authNote).toBe('credentials configured');
  });

  it('carries field definitions, public values, has flags and missing names', () => {
    const views = new Map<string, ProviderConfigView>([
      [
        'adzuna',
        view('adzuna', { values: { appId: 'app-1' }, secrets: { appKey: 'enc:v1:sealed' } }),
      ],
    ]);
    const [row] = buildSearchProviders([adzuna], views, new Map());
    expect(row!.fields.map((f) => f.name)).toEqual(['appId', 'appKey']);
    expect(row!.fields.find((f) => f.name === 'appKey')!.secret).toBe(true);
    expect(row!.values).toEqual({ appId: 'app-1' });
    expect(row!.values['appKey']).toBeUndefined();
    expect(row!.has).toEqual({ appKey: true });
    expect(row!.configured).toBe(true);
    expect(row!.missing).toEqual([]);
  });

  it('reports declared usage limits and never invents quota/used', () => {
    const views = new Map([['firecrawl', view('firecrawl', null, { FIRECRAWL_API_KEY: 'k' })]]);
    const [fc] = buildSearchProviders([firecrawl], views, new Map());
    expect(fc!.host).toBe('api.firecrawl.dev');
    expect(fc!.usage).toContain('Free plan');
    expect(fc!.quota).toBeNull();
    expect(fc!.used).toBeNull();
  });

  it('reads addedAt from the observed sources, including the firecrawl-search alias', () => {
    const map = new Map([['firecrawl-search', '2026-09-01']]);
    const [fc] = buildSearchProviders([firecrawl], new Map(), map);
    expect(fc!.addedAt).toBe('2026-09-01');
    const [none] = buildSearchProviders([remotive], new Map(), new Map());
    expect(none!.addedAt).toBeNull();
  });

  it('resolves the dynamic Workday host from stored values', () => {
    const views = new Map([
      ['workday', view('workday', { values: { host: 'acme.wd1.myworkdayjobs.com' }, secrets: {} })],
    ]);
    const [wd] = buildSearchProviders([{ id: 'workday', name: 'Workday' }], views, new Map());
    expect(wd!.host).toBe('acme.wd1.myworkdayjobs.com');
    expect(wd!.missing).toEqual(['tenant', 'site']);
  });

  it('returns [] for an empty adapter registry', () => {
    expect(buildSearchProviders([], new Map(), new Map())).toEqual([]);
  });
});

describe('isProviderConfigured', () => {
  it('is true for keyless adapters and false until all required fields exist', () => {
    expect(isProviderConfigured('remotive', new Map())).toBe(true);
    expect(isProviderConfigured('firecrawl', new Map())).toBe(false);
    expect(
      isProviderConfigured('firecrawl', new Map([['firecrawl', view('firecrawl', null, { FIRECRAWL_API_KEY: 'x' })]])),
    ).toBe(true);
    expect(
      isProviderConfigured('adzuna', new Map([['adzuna', view('adzuna', null, { ADZUNA_APP_ID: 'a' })]])),
    ).toBe(false);
    expect(
      isProviderConfigured(
        'adzuna',
        new Map([['adzuna', view('adzuna', null, { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' })]]),
      ),
    ).toBe(true);
  });
});

describe('SearchProvidersService', () => {
  function service(rows: Array<{ primarySource: string; _min: { firstSeenAt: Date | null } }>, views = new Map<string, ProviderConfigView>()) {
    const prisma = {
      normalizedJob: { groupBy: async () => rows },
    };
    const providerConfig = {
      views: vi.fn(async (ids: readonly string[]) => {
        const out = new Map(views);
        for (const id of ids) if (!out.has(id)) out.set(id, view(id, null, {}));
        return out;
      }),
      save: vi.fn(async (id: string) => view(id, { values: {}, secrets: {} })),
    };
    return { svc: new SearchProvidersService(prisma as never, providerConfig as never), providerConfig };
  }

  it('returns a providers envelope and maps first-seen dates', async () => {
    const { svc } = service([
      { primarySource: 'remotive', _min: { firstSeenAt: new Date('2026-09-20T00:00:00Z') } },
    ]);
    const out = await svc.list({});
    expect(Array.isArray(out.providers)).toBe(true);
    expect(out.providers.find((p) => p.id === 'remotive')!.addedAt).toBe('2026-09-20');
  });

  it('handles a null min date without emitting a bogus addedAt', async () => {
    const { svc } = service([{ primarySource: 'remotive', _min: { firstSeenAt: null } }]);
    const out = await svc.list({});
    expect(out.providers.find((p) => p.id === 'remotive')!.addedAt).toBeNull();
  });

  it('returns workloads only when the backing provider is configured', async () => {
    const unconfigured = await service([]).svc.workloads({});
    expect(unconfigured.workloads).toEqual([]);

    const configuredViews = new Map<string, ProviderConfigView>([
      ['firecrawl', view('firecrawl', null, { FIRECRAWL_API_KEY: 'fc-1' })],
    ]);
    const configured = await service([], configuredViews).svc.workloads({});
    expect(configured.workloads).toEqual(
      [...SEARCH_PROVIDER_WORKLOAD_DEFS].map((d) => ({
        workload: d.workload,
        provider: d.provider,
        schedule: d.schedule,
      })),
    );
    expect(configured.workloads.length).toBeGreaterThan(0);
  });

  it('save persists via ProviderConfigService and returns the refreshed card', async () => {
    const { svc, providerConfig } = service([]);
    const result = await svc.save('firecrawl', { values: { apiKey: 'fc-new' } });
    expect(providerConfig.save).toHaveBeenCalledWith('firecrawl', { values: { apiKey: 'fc-new' } }, process.env);
    expect(result.id).toBe('firecrawl');
    expect(result.fields.some((f) => f.name === 'apiKey')).toBe(true);
  });
});
