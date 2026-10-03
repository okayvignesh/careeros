// Screen 56 backend. "Search providers" here are the configured job-source
// adapters (the registry in `@careeros/job-pipeline`) — the external services
// this install is actually wired to search/crawl for jobs. There is no
// persisted per-provider usage counter yet, so `quota`/`used` are null and the
// UI says "not tracked" instead of inventing a monthly number. `addedAt` is the
// first persisted job from that source, or null when it has never returned one.
import { Injectable } from '@nestjs/common';
import { adapters } from '@careeros/job-pipeline';
import {
  rateLimitFor,
  type SearchProvider,
  type SearchProviderWorkload,
  type SearchProvidersResponse,
} from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Static upstream metadata per adapter id (factual hosts, not secrets). */
const PROVIDER_META: Record<string, { host: string; requiredEnv: string[] }> = {
  ashby: { host: 'api.ashbyhq.com', requiredEnv: ['ASHBY_ORG_IDS'] },
  greenhouse: { host: 'boards-api.greenhouse.io', requiredEnv: ['GREENHOUSE_BOARD_TOKENS'] },
  lever: { host: 'api.lever.co', requiredEnv: ['LEVER_SITE_SLUGS'] },
  smartrecruiters: {
    host: 'api.smartrecruiters.com',
    requiredEnv: ['SMARTRECRUITERS_COMPANY_IDS'],
  },
  workable: { host: 'apply.workable.com', requiredEnv: ['WORKABLE_ACCOUNTS'] },
  adzuna: { host: 'api.adzuna.com', requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'] },
  arbeitnow: { host: 'www.arbeitnow.com', requiredEnv: [] },
  remotive: { host: 'remotive.com', requiredEnv: [] },
  firecrawl: { host: 'api.firecrawl.dev', requiredEnv: ['FIRECRAWL_API_KEY'] },
  workday: { host: '', requiredEnv: ['WORKDAY_HOST', 'WORKDAY_TENANT', 'WORKDAY_SITE'] },
  icims: {
    host: 'api.icims.com',
    requiredEnv: ['ICIMS_CUSTOMER_ID', 'ICIMS_API_USER', 'ICIMS_API_PASSWORD'],
  },
  successfactors: {
    host: '',
    requiredEnv: ['SF_API_HOST', 'SF_COMPANY_ID', 'SF_API_USER', 'SF_API_PASSWORD'],
  },
};

/** Dynamic-host adapters read their host from config rather than a constant. */
function resolveHost(adapterId: string, fallback: string, env: NodeJS.ProcessEnv): string {
  if (adapterId === 'workday') return env['WORKDAY_HOST']?.trim() || fallback || 'not configured';
  if (adapterId === 'successfactors')
    return env['SF_API_HOST']?.trim() || fallback || 'not configured';
  return fallback || 'not configured';
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when every env var this adapter needs is present (empty list = keyless). */
export function isProviderConfigured(adapterId: string, env: NodeJS.ProcessEnv): boolean {
  const meta = PROVIDER_META[adapterId] ?? { host: '', requiredEnv: [] };
  return meta.requiredEnv.every((key) => isSet(env[key]));
}

/**
 * Pure builder so the config-derived fields are unit-testable without a DB.
 * `addedAtBySource` maps `NormalizedJob.primarySource` → earliest ISO date.
 */
export function buildSearchProviders(
  sourceAdapters: readonly { id: string; name: string }[],
  env: NodeJS.ProcessEnv,
  addedAtBySource: ReadonlyMap<string, string>,
): SearchProvider[] {
  return sourceAdapters.map((a) => {
    const meta = PROVIDER_META[a.id] ?? { host: '', requiredEnv: [] };
    const missing = meta.requiredEnv.filter((key) => !isSet(env[key]));
    const configured = missing.length === 0;
    const addedAt =
      addedAtBySource.get(a.id) ??
      (a.id === 'firecrawl' ? (addedAtBySource.get('firecrawl-search') ?? null) : null);
    return {
      id: a.id,
      name: a.name,
      host: resolveHost(a.id, meta.host, env),
      status: configured ? 'active' : 'standby',
      addedAt,
      usage: rateLimitFor(a.id)?.note ?? 'No declared upstream limit.',
      quota: null,
      used: null,
      authNote:
        meta.requiredEnv.length === 0
          ? 'none required'
          : configured
            ? 'credentials configured'
            : `missing ${missing.join(', ')}`,
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
  constructor(private readonly prisma: PrismaService) {}

  async list(env: NodeJS.ProcessEnv = process.env): Promise<SearchProvidersResponse> {
    const addedAtBySource = await this.loadFirstSeen();
    return { providers: buildSearchProviders(adapters, env, addedAtBySource) };
  }

  async workloads(
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<{ workloads: SearchProviderWorkload[] }> {
    const workloads = SEARCH_PROVIDER_WORKLOAD_DEFS.filter((d) =>
      isProviderConfigured(d.providerId, env),
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
