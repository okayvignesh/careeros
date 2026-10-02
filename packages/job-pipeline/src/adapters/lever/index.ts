import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MalformedResponseError } from '../errors';

/**
 * Lever public Postings API — https://github.com/lever/postings-api
 * Endpoint: `GET https://api.lever.co/v0/postings/{site}?mode=json&skip=&limit=`
 * (EU instance: `https://api.eu.lever.co/v0/postings/{site}`). No auth for
 * public boards; the response is a bare JSON array of postings.
 *
 * Rate limits: the v0 Postings API is rate-limited per IP but Lever publishes
 * no read ceiling (only application POSTs are capped at 2 req/s). We keep a
 * polite ~60 req/min ceiling and honor 429 via `packages/shared/retry`.
 *
 * ponytail: fetches each site's full board each sync — Lever has no
 * `updatedSince` cursor on v0. Cross-source dedupe (canonicalUrl) absorbs the
 * cost. Skip/limit pagination stops on the first short page.
 */

export const LEVER_SOURCE_NAME = 'lever';
export const LEVER_DEFAULT_PAGE_SIZE = 100;

const LEVER_HOST = 'api.lever.co';
const LEVER_EU_HOST = 'api.eu.lever.co';

export const LeverPostingSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    categories: z
      .object({
        location: z.string().optional(),
        team: z.string().optional(),
        department: z.string().optional(),
        commitment: z.string().optional(),
        allLocations: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    createdAt: z.number().optional(),
    hostedUrl: z.string().url().optional(),
    applyUrl: z.string().url().optional(),
    description: z.string().optional(),
    descriptionPlain: z.string().optional(),
    openingPlain: z.string().optional(),
    additionalPlain: z.string().optional(),
    country: z.string().optional(),
    workplaceType: z.string().optional(),
    salaryRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        currency: z.string().optional(),
        interval: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type LeverPosting = z.infer<typeof LeverPostingSchema>;

export const LeverBoardSchema = z.array(LeverPostingSchema);

export interface LeverAdapterOpts {
  /** Lever site slugs to poll. Defaults to $LEVER_SITE_SLUGS split on comma. */
  sites?: string[];
  /** `eu` selects api.eu.lever.co; `global` (default) uses api.lever.co. */
  region?: 'global' | 'eu';
  /** Rows per request (Lever default 100). */
  pageSize?: number;
  /** Hard page cap per site. Defaults 5 (Lever's own board is tiny). */
  maxPages?: number;
  /** Employer display name override; defaults to the site slug. */
  companyName?: string;
  /** Test hook: override the base URL. Prod always uses api.lever.co. */
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createLeverAdapter(opts: LeverAdapterOpts = {}): JobSourceAdapter {
  const sites = opts.sites ?? envSites();
  const region = opts.region ?? (process.env.LEVER_REGION === 'eu' ? 'eu' : 'global');
  const host = region === 'eu' ? LEVER_EU_HOST : LEVER_HOST;
  const base = opts.baseUrl ?? `https://${host}/v0/postings`;
  const pageSize = opts.pageSize ?? LEVER_DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 5;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [host, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: LEVER_SOURCE_NAME,
    name: 'Lever',
    tier: 1,
    licenseHint: 'Public ATS postings API; per-listing rights owned by originating employer.',
    attribution: 'Sourced via Lever (lever.co). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (sites.length === 0) return [];
      const all: RawJob[] = [];
      for (const site of sites) {
        let skip = 0;
        for (let page = 0; page < maxPages; page += 1) {
          const url = `${base}/${encodeURIComponent(site)}?mode=json&skip=${skip}&limit=${pageSize}`;
          const body = await retry(() => fetchBoard(url, safeFetchOpts, site), {
            attempts: opts.retryAttempts ?? 3,
            baseMs: 500,
          });
          for (const p of body) {
            const mapped = mapLever(p, site, opts.companyName);
            if (mapped) all.push(mapped);
          }
          if (body.length < pageSize) break;
          skip += body.length;
        }
      }
      return all;
    },
  };
}

/** Default instance for the registry. Env-driven; empty site list → no network. */
export const leverAdapter: JobSourceAdapter = createLeverAdapter();

function envSites(): string[] {
  const raw = process.env.LEVER_SITE_SLUGS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchBoard(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  site: string,
): Promise<LeverPosting[]> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`lever ${site} fetch failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const parsed = LeverBoardSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('lever', `site=${site} body is not a posting array`);
  }
  return parsed.data;
}

/** Exported for tests. Returns null if the row is unusable (missing id/title/url). */
export function mapLever(p: LeverPosting, site: string, companyName?: string): RawJob | null {
  if (!p.id || !p.text) return null;
  const url = p.hostedUrl ?? p.applyUrl;
  if (!url || !z.string().url().safeParse(url).success) return null;
  const location = p.categories?.location ?? p.categories?.allLocations?.[0] ?? null;
  const created = typeof p.createdAt === 'number' ? new Date(p.createdAt) : null;
  const html = p.description ?? '';
  const description = (p.descriptionPlain ?? (stripHtml(html) || p.openingPlain || '')).trim() || p.text;
  const remote = inferLeverRemote(p.workplaceType, `${location ?? ''} ${p.text}`);
  return {
    sourceId: `${site}:${p.id}`.slice(0, 200),
    sourceName: LEVER_SOURCE_NAME,
    canonicalUrl: url,
    title: p.text.slice(0, 300),
    company: (companyName ?? site).slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote,
    description: description.slice(0, 50_000),
    sourcePostedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    fetchedAt: new Date(),
    payload: p,
  };
}

/** Lever's `workplaceType` is authoritative when present; hybrid/onsite are not remote. */
export function inferLeverRemote(workplaceType: string | undefined, haystack: string): boolean {
  if (workplaceType) {
    const t = workplaceType.toLowerCase();
    if (t === 'remote') return true;
    if (t === 'hybrid' || t === 'onsite' || t === 'unspecified') return false;
  }
  return /remote|anywhere|worldwide|\bwfh\b/i.test(haystack);
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const leverRateLimit = RATE_LIMITS.lever;

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
