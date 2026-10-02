import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MalformedResponseError, MissingCredentialError } from '../errors';

/**
 * iCIMS Career Portal adapter (F6, owner decision U6).
 *
 * iCIMS publishes no keyless jobs feed; every customer career portal renders
 * from an internal HTML/iframe surface, and the only documented JSON API is the
 * partner-gated Job Portal API —
 *   https://developer-community.icims.com/applications/applicant-tracking/job-portal
 *   List: `GET https://api.icims.com/customers/{customerId}/search/portals/{portalId}`
 *   with HTTP Basic credentials issued through the iCIMS Partner Program.
 *
 * Because the list row carries only `portalUrl`/`id`/`updatedDate`, the title
 * is derived from the canonical `portalUrl` slug (e.g.
 * `/jobs/1709/customer-service-representative/job`); any richer projection
 * fields the customer's Search API returns are preferred when present.
 *
 * Trust: partner-gated career-site data, not a keyless first-party ATS board,
 * so the declared tier is 2 (like Workday) and `verified` must be set
 * explicitly — once an operator confirms the customer/portal is canonical —
 * before it counts as tier 1 (VERIFIED ATS).
 */

export const ICIMS_SOURCE_NAME = 'icims';
export const ICIMS_TRUST_TIER_UNVERIFIED = 'UNVERIFIED' as const;
export const ICIMS_TRUST_TIER_VERIFIED = 'VERIFIED' as const;
export const ICIMS_DEFAULT_PORTAL_ID = 'jobs';
export const ICIMS_DEFAULT_PAGE_SIZE = 100;

const ICIMS_HOST = 'api.icims.com';
const ICIMS_BASE = `https://${ICIMS_HOST}/customers`;

export const IcimsSearchResultSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    portalUrl: z.string().url(),
    self: z.string().url().optional(),
    updatedDate: z.string().optional(),
    // Enriched fields, present only when the customer's Search API projection
    // includes them. The default portal projection does not.
    jobtitle: z.string().optional(),
    jobTitle: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    joblocation: z.string().optional(),
  })
  .passthrough();
export type IcimsSearchResult = z.infer<typeof IcimsSearchResultSchema>;

export const IcimsSearchResponseSchema = z
  .object({
    searchResults: z.array(IcimsSearchResultSchema),
  })
  .passthrough();

export interface IcimsAdapterOpts {
  /** iCIMS customer id. Defaults $ICIMS_CUSTOMER_ID. */
  customerId?: string;
  /** Portal id or name. Defaults $ICIMS_PORTAL_ID or `jobs`. */
  portalId?: string;
  /** Basic-auth user. Defaults $ICIMS_API_USER. */
  user?: string;
  /** Basic-auth password. Defaults $ICIMS_API_PASSWORD. */
  password?: string;
  /** Employer display name. Defaults $ICIMS_COMPANY_NAME or the customer id. */
  companyName?: string;
  /** Rows per request. Defaults 100. */
  pageSize?: number;
  /** Hard page cap per fetch. Defaults 5. */
  maxPages?: number;
  /** Operator confirmation that this portal is canonical → tier 1. Defaults false. */
  verified?: boolean;
  /** Test hook: override the API base (must still be allowlisted). */
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createIcimsAdapter(opts: IcimsAdapterOpts = {}): JobSourceAdapter {
  const customerId = (opts.customerId ?? process.env.ICIMS_CUSTOMER_ID ?? '').trim();
  const portalId = (opts.portalId ?? process.env.ICIMS_PORTAL_ID ?? ICIMS_DEFAULT_PORTAL_ID).trim();
  const user = opts.user ?? process.env.ICIMS_API_USER ?? '';
  const password = opts.password ?? process.env.ICIMS_API_PASSWORD ?? '';
  const companyName = (
    opts.companyName ??
    process.env.ICIMS_COMPANY_NAME ??
    customerId
  ).trim();
  const pageSize = opts.pageSize ?? ICIMS_DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 5;
  const verified = opts.verified ?? false;
  const base = opts.baseUrl ?? ICIMS_BASE;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [ICIMS_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: ICIMS_SOURCE_NAME,
    name: 'iCIMS',
    tier: verified ? 1 : 2,
    licenseHint:
      'Public employer career portal via the partner Job Portal API. Listings © the originating employer.',
    attribution: 'Sourced from the employer’s public iCIMS career portal.',
    async fetch(): Promise<RawJob[]> {
      if (!customerId || !portalId) return [];
      const missing: string[] = [];
      if (!user) missing.push('ICIMS_API_USER');
      if (!password) missing.push('ICIMS_API_PASSWORD');
      if (missing.length > 0) throw new MissingCredentialError(ICIMS_SOURCE_NAME, missing);

      const out: RawJob[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const url = `${base}/${encodeURIComponent(customerId)}/search/portals/${encodeURIComponent(portalId)}?page=${page}&pageSize=${pageSize}`;
        const body = await retry(
          () => fetchPage(url, safeFetchOpts, user, password, customerId),
          { attempts: opts.retryAttempts ?? 3, baseMs: 500 },
        );
        for (const row of body.searchResults) {
          const mapped = mapIcims(row, customerId, companyName);
          if (mapped) out.push(mapped);
        }
        if (body.searchResults.length === 0 || body.searchResults.length < pageSize) break;
      }
      return out;
    },
  };
}

/** Default registry instance. Env-driven; unset customer/portal → no network. */
export const icimsAdapter: JobSourceAdapter = createIcimsAdapter();

async function fetchPage(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  user: string,
  password: string,
  customerId: string,
): Promise<z.infer<typeof IcimsSearchResponseSchema>> {
  const auth = Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
  const res = await safeFetch(
    url,
    { headers: { accept: 'application/json', authorization: `Basic ${auth}` } },
    safeFetchOpts,
  );
  if (!res.ok) {
    const err = new Error(`icims customer=${customerId} fetch failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const parsed = IcimsSearchResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('icims', `customer=${customerId} missing 'searchResults'`);
  }
  return parsed.data;
}

/** Exported for tests. Returns null if the row is unusable (no id/url). */
export function mapIcims(
  row: IcimsSearchResult,
  customerId: string,
  companyName?: string,
): RawJob | null {
  if (row.id === undefined || row.id === null) return null;
  if (!row.portalUrl || !z.string().url().safeParse(row.portalUrl).success) return null;

  const title =
    firstNonEmpty(row.jobtitle, row.jobTitle, row.title) ?? titleFromPortalUrl(row.portalUrl);
  if (!title) return null;

  const location = firstNonEmpty(row.location, row.joblocation);
  const posted = row.updatedDate ? parseIcimsDate(row.updatedDate) : null;
  const description = (row.description ? stripHtml(row.description) : '').trim() || title;

  return {
    sourceId: `${customerId}:${String(row.id)}`.slice(0, 200),
    sourceName: ICIMS_SOURCE_NAME,
    canonicalUrl: row.portalUrl,
    title: title.slice(0, 300),
    company: (firstNonEmpty(row.company) ?? companyName ?? customerId).slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote: /remote|anywhere|worldwide/i.test(`${title} ${location ?? ''}`),
    description: description.slice(0, 50_000),
    sourcePostedAt: posted,
    fetchedAt: new Date(),
    payload: row,
  };
}

/** Pull a human title out of `/jobs/{id}/{slug}/job`. Exported for tests. */
export function titleFromPortalUrl(rawUrl: string): string | null {
  let parts: string[];
  try {
    parts = new URL(rawUrl).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
  const jobsIdx = parts.indexOf('jobs');
  const slug = jobsIdx >= 0 ? parts[jobsIdx + 2] : parts[parts.length - 2];
  if (!slug) return null;
  const decoded = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return null;
  return decoded.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** iCIMS `updatedDate` is `YYYY-MM-DD hh:mm AM` (no zone); unparseable → null. */
export function parseIcimsDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const icimsRateLimit = RATE_LIMITS.icims;

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
