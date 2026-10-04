// Screen 56 backend. "Search providers" here are the configured job-source
// adapters (the registry in `@careeros/job-pipeline`) — the external services
// this install is actually wired to search/crawl for jobs. There is no
// persisted per-provider usage counter yet, so `quota`/`used` are null and the
// UI says "not tracked" instead of inventing a monthly number. `addedAt` is the
// first persisted job from that source, or null when it has never returned one.
//
// Credentials come from the DB (`provider_config:<id>` via ProviderConfigService)
// with env only as a last-resort fallback, so the settings UI is the primary
// path. Secrets are sealed at rest and never leave the API.
import { Injectable, NotFoundException } from '@nestjs/common';
import { adapters } from '@careeros/job-pipeline';
import {
  providerFields,
  rateLimitFor,
  resolveProviderConfig,
  type ProviderFieldsInput,
  type ProviderConfigView,
  type SearchProvider,
  type SearchProviderWorkload,
  type SearchProvidersResponse,
} from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderConfigService } from '../../common/provider-config.service';

/** Static upstream metadata per adapter id (factual hosts, not secrets). */
const PROVIDER_META: Record<string, { host: string }> = {
  ashby: { host: 'api.ashbyhq.com' },
  greenhouse: { host: 'boards-api.greenhouse.io' },
  lever: { host: 'api.lever.co' },
  smartrecruiters: { host: 'api.smartrecruiters.com' },
  workable: { host: 'apply.workable.com' },
  adzuna: { host: 'api.adzuna.com' },
  arbeitnow: { host: 'www.arbeitnow.com' },
  remotive: { host: 'remotive.com' },
  firecrawl: { host: 'api.firecrawl.dev' },
  workday: { host: '' },
  icims: { host: 'api.icims.com' },
  successfactors: { host: '' },
};

/** Dynamic-host adapters read their host from stored config rather than a constant. */
function resolveHost(adapterId: string, fallback: string, view: ProviderConfigView): string {
  if (adapterId === 'workday') return view.values['host']?.trim() || fallback || 'not configured';
  if (adapterId === 'successfactors')
    return view.values['apiHost']?.trim() || fallback || 'not configured';
  return fallback || 'not configured';
}

/** True when every required field for this adapter is present (DB first, env fallback). */
export function isProviderConfigured(
  adapterId: string,
  configByProvider: ReadonlyMap<string, ProviderConfigView>,
): boolean {
  return (configByProvider.get(adapterId) ?? resolveProviderConfig(adapterId, null, {})).configured;
}

/**
 * Pure builder so the config-derived fields are unit-testable without a DB.
 * `configByProvider` carries the DB-derived views; `addedAtBySource` maps
 * `NormalizedJob.primarySource` → earliest ISO date.
 */
export function buildSearchProviders(
  sourceAdapters: readonly { id: string; name: string }[],
  configByProvider: ReadonlyMap<string, ProviderConfigView>,
  addedAtBySource: ReadonlyMap<string, string>,
): SearchProvider[] {
  return sourceAdapters.map((a) => {
    const meta = PROVIDER_META[a.id] ?? { host: '' };
    const view = configByProvider.get(a.id) ?? resolveProviderConfig(a.id, null, {});
    const fields = providerFields(a.id);
    const missing = view.missing;
    const configured = view.configured;
    const addedAt =
      addedAtBySource.get(a.id) ??
      (a.id === 'firecrawl' ? (addedAtBySource.get('firecrawl-search') ?? null) : null);
    return {
      id: a.id,
      name: a.name,
      host: resolveHost(a.id, meta.host, view),
      status: configured ? 'active' : 'standby',
      addedAt,
      usage: rateLimitFor(a.id)?.note ?? 'No declared upstream limit.',
      quota: null,
      used: null,
      authNote:
        fields.length === 0
          ? 'none required'
          : configured
            ? 'credentials configured'
            : `missing ${missing.join(', ')}`,
      fields: fields.map((f) => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })),
      values: view.values,
      has: view.has,
      configured,
      missing,
    } satisfies SearchProvider;
  });
}

/**
 * Scheduled workloads that consume a search provider. Mirrors the worker
 * registration `FIRECRAWL_SEARCH_CRON` (6-hourly) at
 * apps/worker/src/firecrawl-search.worker.ts. A workload is only reported when
 * its provider is configured, so an install with no key sees `[]` rather than
 * a job that no-ops. Kept static here because the API cannot import the worker
 * package and the schedule is part of the contract.
 */
interface WorkloadDef extends SearchProviderWorkload {
  providerId: string;
}

export const SEARCH_PROVIDER_WORKLOAD_DEFS: readonly WorkloadDef[] = [
  {
    workload: 'Candidate job discovery',
    provider: 'Firecrawl',
    providerId: 'firecrawl',
    schedule: 'every 6 hours',
  },
];

@Injectable()
export class SearchProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  async list(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<SearchProvidersResponse> {
    const ids = adapters.map((a) => a.id);
    const [addedAtBySource, views] = await Promise.all([
      this.loadFirstSeen(),
      this.providerConfig.views(ids, env),
    ]);
    return { providers: buildSearchProviders(adapters, views, addedAtBySource) };
  }

  /** Save one provider's config and return its refreshed card. */
  async save(
    id: string,
    input: ProviderFieldsInput,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<SearchProvider> {
    if (!adapters.some((a) => a.id === id)) throw new NotFoundException(`Unknown provider: ${id}`);
    const view = await this.providerConfig.save(id, input, env);
    const addedAtBySource = await this.loadFirstSeen();
    const [provider] = buildSearchProviders(adapters, new Map([[id, view]]), addedAtBySource).filter(
      (p) => p.id === id,
    );
    if (!provider) throw new NotFoundException(`Unknown provider: ${id}`);
    return provider;
  }

  async workloads(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<{ workloads: SearchProviderWorkload[] }> {
    const views = await this.providerConfig.views(
      SEARCH_PROVIDER_WORKLOAD_DEFS.map((d) => d.providerId),
      env,
    );
    const workloads = SEARCH_PROVIDER_WORKLOAD_DEFS.filter((d) =>
      isProviderConfigured(d.providerId, views),
    ).map((d) => ({ workload: d.workload, provider: d.provider, schedule: d.schedule }));
    return { workloads };
  }

  private async loadFirstSeen(): Promise<Map<string, string>> {
    const rows = await this.prisma.normalizedJob.groupBy({
      by: ['primarySource'],
      _min: { firstSeenAt: true },
    });
    const out = new Map<string, string>();
    for (const row of rows) {
      if (row._min.firstSeenAt) {
        out.set(row.primarySource, row._min.firstSeenAt.toISOString().slice(0, 10));
      }
    }
    return out;
  }
}
