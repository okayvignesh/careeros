import { retry, safeFetch, type AssertPublicUrlOptions } from '@careeros/shared';
import type { JobSourceAdapter, RawJob } from '../types';
import { MalformedResponseError } from './errors';

/**
 * Arbeitnow public jobs API — https://documenter.getpostman.com/view/18545278/UVJbJdKh
 * Endpoint: `https://www.arbeitnow.com/api/job-board-api` — free, unauthenticated.
 * Response returns `{ data: [...], links, meta }`.
 *
 * Rate limits: none formally published; treat as best-effort and back off on
 * 429/5xx via shared retry.
 *
 * ponytail: single-page fetch (Arbeitnow returns ~100 rows per page). No
 * pagination — dedupe by canonicalUrl handles re-runs. Add page walking if the
 * feed grows large enough that page 1 misses fresh rows.
 */

// Arbeitnow docs point at arbeitnow.com but the JSON endpoint is served on
// www.arbeitnow.com. Both should route the same but we pin the host we actually
// hit so the allowlist match is honest.
const ARBEITNOW_HOST = 'www.arbeitnow.com';
const ARBEITNOW_URL = `https://${ARBEITNOW_HOST}/api/job-board-api`;

export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number; // unix seconds
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
  meta?: unknown;
}

export interface ArbeitnowAdapterOpts {
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createArbeitnowAdapter(opts: ArbeitnowAdapterOpts = {}): JobSourceAdapter {
  const url = opts.baseUrl ?? ARBEITNOW_URL;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [ARBEITNOW_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    tier: 2,
    licenseHint: 'Public JSON feed; per-listing rights owned by originating employer.',
    attribution: 'Sourced via Arbeitnow (arbeitnow.com). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      const body = await retry(async () => fetchFeed(url, safeFetchOpts), {
        attempts: opts.retryAttempts ?? 3,
        baseMs: 500,
      });
      const out: RawJob[] = [];
      for (const j of body.data ?? []) {
        const mapped = mapArbeitnow(j);
        if (mapped) out.push(mapped);
      }
      return out;
    },
  };
}

export const arbeitnowAdapter: JobSourceAdapter = createArbeitnowAdapter();

async function fetchFeed(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
): Promise<ArbeitnowResponse> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`arbeitnow fetch failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MalformedResponseError('arbeitnow', 'body not JSON');
  }
  if (data === null || typeof data !== 'object' || !('data' in data)) {
    throw new MalformedResponseError('arbeitnow', "missing 'data' array");
  }
  return data as ArbeitnowResponse;
}

/** Exported for tests. */
export function mapArbeitnow(j: ArbeitnowJob): RawJob | null {
  if (!j.slug || !j.url || !j.title || !j.company_name) return null;
  const posted = typeof j.created_at === 'number' ? new Date(j.created_at * 1000) : null;
  return {
    sourceId: j.slug,
    sourceName: 'arbeitnow',
    canonicalUrl: j.url,
    title: j.title,
    company: j.company_name,
    location: j.location || null,
    remote: Boolean(j.remote),
    description: j.description || j.title,
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: j,
  };
}
