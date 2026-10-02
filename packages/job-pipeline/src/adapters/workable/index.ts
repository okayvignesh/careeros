import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MalformedResponseError } from '../errors';

/**
 * Workable public jobs widget —
 * `GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true`
 * No auth for published boards. Response is `{ name, description, jobs: [...] }`
 * with the full description/requirements/benefits inline (`details=true`).
 *
 * Rate limits: Workable's public surface has an aggressive per-IP heuristic
 * (soft-bans after ~100 rapid requests), so we keep a low ceiling and honor
 * 429 via `packages/shared/retry`.
 *
 * ponytail: Workable returns the entire board in one response and ignores
 * `page`/`limit`/`offset` query params, so there is no server cursor to page —
 * the adapter caps a sync with `maxJobs` instead. If Workable ever ships a
 * cursor this becomes the standard page loop.
 */

export const WORKABLE_SOURCE_NAME = 'workable';
export const WORKABLE_DEFAULT_MAX_JOBS = 500;

const WORKABLE_HOST = 'apply.workable.com';
const WORKABLE_BASE = `https://${WORKABLE_HOST}/api/v1/widget/accounts`;

const WorkableLocationSchema = z
  .object({
    country: z.string().optional(),
    countryCode: z.string().optional(),
    city: z.string().optional(),
    region: z.string().nullish(),
    hidden: z.boolean().optional(),
  })
  .passthrough();

export const WorkableJobSchema = z
  .object({
    id: z.number().optional(),
    title: z.string().min(1),
    shortcode: z.string().min(1),
    code: z.string().optional(),
    employment_type: z.string().optional(),
    telecommuting: z.boolean().optional(),
    department: z.string().optional(),
    url: z.string().url().optional(),
    shortlink: z.string().url().optional(),
    application_url: z.string().url().optional(),
    published_on: z.string().optional(),
    created_at: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    description: z.string().optional(),
    requirements: z.string().optional(),
    benefits: z.string().optional(),
    function: z.string().optional(),
    industry: z.string().optional(),
    locations: z.array(WorkableLocationSchema).optional(),
  })
  .passthrough();
export type WorkableJob = z.infer<typeof WorkableJobSchema>;

export const WorkableBoardSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullish(),
    jobs: z.array(WorkableJobSchema),
  })
  .passthrough();

export interface WorkableAdapterOpts {
  /** Workable subdomains/accounts to poll. Defaults to $WORKABLE_ACCOUNTS split on comma. */
  accounts?: string[];
  /** Hard cap on rows emitted per sync. Defaults 500. */
  maxJobs?: number;
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createWorkableAdapter(opts: WorkableAdapterOpts = {}): JobSourceAdapter {
  const accounts = opts.accounts ?? envAccounts();
  const base = opts.baseUrl ?? WORKABLE_BASE;
  const maxJobs = opts.maxJobs ?? WORKABLE_DEFAULT_MAX_JOBS;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [WORKABLE_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: WORKABLE_SOURCE_NAME,
    name: 'Workable',
    tier: 1,
    licenseHint: 'Public ATS postings widget; per-listing rights owned by originating employer.',
    attribution: 'Sourced via Workable (workable.com). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (accounts.length === 0) return [];
      const all: RawJob[] = [];
      for (const account of accounts) {
        if (all.length >= maxJobs) break;
        const url = `${base}/${encodeURIComponent(account)}?details=true`;
        const board = await retry(() => fetchBoard(url, safeFetchOpts, account), {
          attempts: opts.retryAttempts ?? 3,
          baseMs: 500,
        });
        for (const job of board.jobs) {
          if (all.length >= maxJobs) break;
          const mapped = mapWorkable(job, account, board.name);
          if (mapped) all.push(mapped);
        }
      }
      return all;
    },
  };
}

/** Default registry instance. Env-driven; empty account list → no network. */
export const workableAdapter: JobSourceAdapter = createWorkableAdapter();

function envAccounts(): string[] {
  const raw = process.env.WORKABLE_ACCOUNTS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchBoard(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  account: string,
): Promise<z.infer<typeof WorkableBoardSchema>> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`workable ${account} fetch failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const parsed = WorkableBoardSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('workable', `account=${account} missing 'jobs' array`);
  }
  return parsed.data;
}

/** Exported for tests. Returns null if the row is unusable (missing title/url). */
export function mapWorkable(job: WorkableJob, account: string, boardName?: string): RawJob | null {
  if (!job.title || !job.shortcode) return null;
  const url = job.url ?? job.shortlink ?? job.application_url;
  if (!url || !z.string().url().safeParse(url).success) return null;

  const loc = job.locations?.[0];
  const city = loc?.city?.trim() || job.city?.trim() || '';
  const region = loc?.region?.trim() || job.state?.trim() || '';
  const country = loc?.country?.trim() || job.country?.trim() || '';
  const location = [city, region, country].filter(Boolean).join(', ') || null;
  const remote = Boolean(job.telecommuting) || /remote|anywhere|worldwide/i.test(location ?? '');

  const postedRaw = job.published_on ?? job.created_at ?? null;
  const posted = postedRaw ? new Date(postedRaw) : null;
  const description =
    stripHtml([job.description, job.requirements, job.benefits].filter(Boolean).join('\n\n')).trim() ||
    job.title;

  return {
    sourceId: `${account}:${job.shortcode}`.slice(0, 200),
    sourceName: WORKABLE_SOURCE_NAME,
    canonicalUrl: url,
    title: job.title.slice(0, 300),
    company: (boardName?.trim() || account).slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote,
    description: description.slice(0, 50_000),
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: job,
  };
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const workableRateLimit = RATE_LIMITS.workable;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
