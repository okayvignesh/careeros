import { retry, safeFetch, type AssertPublicUrlOptions } from '@careeros/shared';
import type { JobSourceAdapter, RawJob } from '../types';
import { MalformedResponseError } from './errors';

/**
 * Ashby public Job Board API — https://developers.ashbyhq.com/reference/publicjobpostinglist
 * Endpoint: `https://api.ashbyhq.com/posting-api/job-board/{orgSlug}?includeCompensation=true`
 * No auth for public boards. Response returns `{ jobs: [...] }`.
 *
 * Rate limits: Ashby's public posting API is not formally rate-limited but a
 * polite ceiling is a few requests per minute per org. We honor 429 via
 * `packages/shared/retry` with exponential backoff.
 *
 * ponytail: fetches every org's full board each sync — no `updatedSince`
 * cursor exists on the public endpoint. Cross-source dedupe (canonicalUrl) in
 * the pipeline stage already handles re-runs; upgrade path is a per-org
 * `If-Modified-Since` header if Ashby ever ships one.
 */

const ASHBY_HOST = 'api.ashbyhq.com';
const ASHBY_BASE = `https://${ASHBY_HOST}/posting-api/job-board`;

export interface AshbyJob {
  id: string;
  title: string;
  location: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  jobUrl: string;
  employmentType?: string;
  team?: string;
  department?: string;
  compensation?: unknown;
}

interface AshbyBoard {
  apiVersion?: string;
  jobs?: AshbyJob[];
}

export interface AshbyAdapterOpts {
  /** Ashby org slugs to poll. Configurable per operator. Defaults to $ASHBY_ORG_IDS split on comma. */
  orgIds?: string[];
  /** Test hook: override the base URL. Prod always uses api.ashbyhq.com. */
  baseUrl?: string;
  /** Extra hostnames merged into `safeFetch` allowlist. Defaults empty. */
  allowlist?: string[];
  /** Injectable DNS resolver for tests. See `AssertPublicUrlOptions.lookup`. */
  lookup?: AssertPublicUrlOptions['lookup'];
  /** Retry attempts on 429/5xx. Defaults to 3. */
  retryAttempts?: number;
  /** Node env override for tests (dev vs prod semantics in safeFetch). */
  nodeEnv?: string;
}

export function createAshbyAdapter(opts: AshbyAdapterOpts = {}): JobSourceAdapter {
  const orgIds = opts.orgIds ?? envOrgIds();
  const base = opts.baseUrl ?? ASHBY_BASE;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [ASHBY_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };
  return {
    id: 'ashby',
    name: 'Ashby',
    tier: 1,
    licenseHint: 'Public ATS posting API; per-listing rights owned by originating employer.',
    attribution: 'Sourced via Ashby (ashbyhq.com). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (orgIds.length === 0) return [];
      const all: RawJob[] = [];
      for (const orgId of orgIds) {
        const url = `${base}/${encodeURIComponent(orgId)}?includeCompensation=true`;
        const board = await retry(async () => fetchBoard(url, safeFetchOpts, orgId), {
          attempts: opts.retryAttempts ?? 3,
          baseMs: 500,
        });
        for (const j of board.jobs ?? []) {
          const mapped = mapAshby(j, orgId);
          if (mapped) all.push(mapped);
        }
      }
      return all;
    },
  };
}

/** Default instance for the registry. Env-driven org list; empty if unset. */
export const ashbyAdapter: JobSourceAdapter = createAshbyAdapter();

function envOrgIds(): string[] {
  const raw = process.env.ASHBY_ORG_IDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchBoard(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  orgId: string,
): Promise<AshbyBoard> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`ashby ${orgId} fetch failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MalformedResponseError('ashby', `org=${orgId} body not JSON`);
  }
  if (data === null || typeof data !== 'object' || !('jobs' in data)) {
    throw new MalformedResponseError('ashby', `org=${orgId} missing 'jobs' array`);
  }
  return data as AshbyBoard;
}

/** Exported for tests. Returns null if the row is unusable (missing url/title). */
export function mapAshby(j: AshbyJob, orgId: string): RawJob | null {
  if (!j.jobUrl || !j.title || !j.id) return null;
  const posted = j.publishedAt ? new Date(j.publishedAt) : null;
  const description = j.descriptionPlain ?? j.descriptionHtml ?? j.title;
  return {
    sourceId: `${orgId}:${j.id}`,
    sourceName: 'ashby',
    canonicalUrl: j.jobUrl,
    title: j.title,
    company: orgId,
    location: j.location || null,
    remote: Boolean(j.isRemote),
    description,
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: j,
  };
}
