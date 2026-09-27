import { retry } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import type { JobSourceAdapter, RawJob } from '../types';
import { MalformedResponseError, MissingCredentialError } from './errors';

/**
 * Adzuna free-tier API — https://developer.adzuna.com/docs/search
 * Endpoint: `https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id=...&app_key=...`
 *
 * Requires env:
 *   - `ADZUNA_APP_ID`  — app id from developer.adzuna.com
 *   - `ADZUNA_APP_KEY` — app key from developer.adzuna.com
 * If missing at fetch time, throws {@link MissingCredentialError} (NOT at import
 * — an unconfigured Adzuna adapter must not crash the whole API boot).
 *
 * Rate limit (free tier): ~25 requests / day / app.
 * ponytail: 25 req/day is enough for one country + one query per day; if the
 * operator needs multi-country + multi-query polling, upgrade to a paid plan
 * (~$500/mo). No client-side quota tracking; a 429 propagates as an error.
 *
 * Cost/scope defaults: single country ('gb' by default), single page (page 1),
 * 50 results per page. Configurable per instance via {@link AdzunaAdapterOpts}.
 */

const ADZUNA_HOST = 'api.adzuna.com';
const ADZUNA_BASE = `https://${ADZUNA_HOST}/v1/api/jobs`;

export interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  created?: string;
  category?: { label?: string; tag?: string };
  contract_type?: string;
  contract_time?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  latitude?: number;
  longitude?: number;
}

interface AdzunaResponse {
  results?: AdzunaJob[];
  count?: number;
  mean?: number;
  __CLASS__?: string;
}

export interface AdzunaAdapterOpts {
  country?: string; // ISO alpha-2, lowercase. Adzuna supports gb, us, de, fr, in, etc.
  page?: number;
  resultsPerPage?: number;
  /** Optional keyword filter. Adzuna API `what` param. */
  what?: string;
  /** Optional location filter. Adzuna API `where` param. */
  where?: string;
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
  /** Test injection: pull credentials from an explicit object instead of env. */
  credentials?: { appId?: string; appKey?: string };
}

export function createAdzunaAdapter(opts: AdzunaAdapterOpts = {}): JobSourceAdapter {
  const country = opts.country ?? 'gb';
  const page = opts.page ?? 1;
  const resultsPerPage = opts.resultsPerPage ?? 50;
  const base = opts.baseUrl ?? ADZUNA_BASE;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [ADZUNA_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: 'adzuna',
    name: 'Adzuna',
    tier: 2,
    licenseHint: 'Aggregator API (free tier ~25 req/day). Attribution required per Adzuna ToS.',
    attribution: 'Powered by Adzuna. Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      const appId = opts.credentials?.appId ?? process.env.ADZUNA_APP_ID ?? '';
      const appKey = opts.credentials?.appKey ?? process.env.ADZUNA_APP_KEY ?? '';
      const missing: string[] = [];
      if (!appId) missing.push('ADZUNA_APP_ID');
      if (!appKey) missing.push('ADZUNA_APP_KEY');
      if (missing.length > 0) throw new MissingCredentialError('adzuna', missing);

      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        results_per_page: String(resultsPerPage),
      });
      if (opts.what) params.set('what', opts.what);
      if (opts.where) params.set('where', opts.where);
      const url = `${base}/${encodeURIComponent(country)}/search/${page}?${params.toString()}`;

      const body = await retry(async () => fetchPage(url, safeFetchOpts), {
        attempts: opts.retryAttempts ?? 3,
        baseMs: 500,
      });

      const out: RawJob[] = [];
      for (const j of body.results ?? []) {
        const mapped = mapAdzuna(j);
        if (mapped) out.push(mapped);
      }
      return out;
    },
  };
}

export const adzunaAdapter: JobSourceAdapter = createAdzunaAdapter();

async function fetchPage(url: string, safeFetchOpts: AssertPublicUrlOptions): Promise<AdzunaResponse> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`adzuna fetch failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MalformedResponseError('adzuna', 'body not JSON');
  }
  if (data === null || typeof data !== 'object' || !('results' in data)) {
    throw new MalformedResponseError('adzuna', "missing 'results' array");
  }
  return data as AdzunaResponse;
}

/** Exported for tests. */
export function mapAdzuna(j: AdzunaJob): RawJob | null {
  if (!j.id || !j.title || !j.redirect_url || !j.description) return null;
  const posted = j.created ? new Date(j.created) : null;
  const location = j.location?.display_name ?? j.location?.area?.join(', ') ?? null;
  const remote = /remote|anywhere|worldwide|work from home/i.test(
    `${j.title} ${location ?? ''} ${j.description}`,
  );
  return {
    sourceId: String(j.id),
    sourceName: 'adzuna',
    canonicalUrl: j.redirect_url,
    title: j.title,
    company: j.company?.display_name ?? 'Unknown',
    location,
    remote,
    description: j.description,
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: j,
  };
}
