import { retry } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import type { JobSourceAdapter, RawJob } from '../types';
import { MalformedResponseError } from './errors';

/**
 * Greenhouse public Job Board API — https://developers.greenhouse.io/job-board.html
 * Endpoint: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
 * No auth for public boards. Response returns `{ jobs: [...] }`.
 *
 * Rate limits: not formally rate-limited on the public boards API but a
 * documented soft ceiling is ~10 req/s per token. We honor 429 via retry.
 *
 * ponytail: fetches every token's full board each sync — no `updated_after`
 * cursor on this endpoint. Dedupe by canonicalUrl absorbs the cost.
 */

const GH_HOST = 'boards-api.greenhouse.io';
const GH_BASE = `https://${GH_HOST}/v1/boards`;

export interface GreenhouseJob {
  id: number;
  internal_job_id?: number;
  title: string;
  updated_at?: string;
  requisition_id?: string;
  location?: { name?: string };
  absolute_url: string;
  content?: string; // HTML, present when ?content=true
  metadata?: unknown;
  company_name?: string;
  first_published?: string;
  departments?: Array<{ name: string }>;
  offices?: Array<{ name: string; location?: string }>;
}

interface GreenhouseBoard {
  jobs?: GreenhouseJob[];
  meta?: { total?: number };
}

export interface GreenhouseAdapterOpts {
  /** Greenhouse board tokens to poll. Defaults to $GREENHOUSE_BOARD_TOKENS split on comma. */
  boardTokens?: string[];
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createGreenhouseAdapter(opts: GreenhouseAdapterOpts = {}): JobSourceAdapter {
  const tokens = opts.boardTokens ?? envTokens();
  const base = opts.baseUrl ?? GH_BASE;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [GH_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };
  return {
    id: 'greenhouse',
    name: 'Greenhouse',
    tier: 1,
    licenseHint: 'Public ATS boards API; per-listing rights owned by originating employer.',
    attribution: 'Sourced via Greenhouse (greenhouse.io). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (tokens.length === 0) return [];
      const all: RawJob[] = [];
      for (const token of tokens) {
        const url = `${base}/${encodeURIComponent(token)}/jobs?content=true`;
        const board = await retry(async () => fetchBoard(url, safeFetchOpts, token), {
          attempts: opts.retryAttempts ?? 3,
          baseMs: 500,
        });
        for (const j of board.jobs ?? []) {
          const mapped = mapGreenhouse(j, token);
          if (mapped) all.push(mapped);
        }
      }
      return all;
    },
  };
}

export const greenhouseAdapter: JobSourceAdapter = createGreenhouseAdapter();

function envTokens(): string[] {
  const raw = process.env.GREENHOUSE_BOARD_TOKENS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchBoard(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  token: string,
): Promise<GreenhouseBoard> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`greenhouse ${token} fetch failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MalformedResponseError('greenhouse', `token=${token} body not JSON`);
  }
  if (data === null || typeof data !== 'object' || !('jobs' in data)) {
    throw new MalformedResponseError('greenhouse', `token=${token} missing 'jobs' array`);
  }
  return data as GreenhouseBoard;
}

/** Exported for tests. */
export function mapGreenhouse(j: GreenhouseJob, token: string): RawJob | null {
  if (!j.absolute_url || !j.title || j.id === undefined) return null;
  const postedRaw = j.first_published ?? j.updated_at ?? null;
  const posted = postedRaw ? new Date(postedRaw) : null;
  const location = j.location?.name ?? j.offices?.[0]?.name ?? null;
  const description = stripHtml(j.content ?? j.title);
  // Greenhouse public API does not carry a remote flag; we heuristic on the
  // location string. Everything downstream (skill extract, freshness, verify)
  // does not depend on this being perfect; the P3 analysis slice replaces it.
  const remote = /remote|anywhere|worldwide/i.test(location ?? '');
  return {
    sourceId: `${token}:${j.id}`,
    sourceName: 'greenhouse',
    canonicalUrl: j.absolute_url,
    title: j.title,
    company: j.company_name ?? token,
    location,
    remote,
    description,
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: j,
  };
}

// Tiny HTML-to-text: strips tags, collapses whitespace. Greenhouse ships full
// HTML in `content`. A full sanitizer is overkill — normalize/skill-extract
// only need plain text for the LLM prompt.
// ponytail: swap for a real sanitizer if downstream ever renders this HTML.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
