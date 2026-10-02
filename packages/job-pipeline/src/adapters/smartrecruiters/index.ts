import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MalformedResponseError } from '../errors';

/**
 * SmartRecruiters public Posting API —
 * https://developers.smartrecruiters.com/docs/posting-api
 * List:   `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings?limit=&offset=`
 * Detail: `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings/{id}`
 * No auth for published postings. List rows are thin (no description); the
 * detail call carries `jobAd.sections` with the full description text.
 *
 * Rate limits: not formally published for public postings; we keep a polite
 * ceiling and honor 429 via `packages/shared/retry`.
 *
 * ponytail: offset/limit pagination stops when `offset >= totalFound` or the
 * page is short. Detail is N+1, bounded by `maxDetails`; a failed detail
 * degrades to the list row rather than dropping the posting.
 */

export const SMARTRECRUITERS_SOURCE_NAME = 'smartrecruiters';
export const SMARTRECRUITERS_DEFAULT_PAGE_SIZE = 100;
export const SMARTRECRUITERS_DEFAULT_MAX_DETAILS = 25;

const SR_HOST = 'api.smartrecruiters.com';
const SR_BASE = `https://${SR_HOST}/v1/companies`;

const SRLocationSchema = z
  .object({
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
    remote: z.boolean().optional(),
    hybrid: z.boolean().optional(),
    fullLocation: z.string().optional(),
  })
  .passthrough();

const SRNamedSchema = z
  .object({ id: z.string().optional(), label: z.string().optional() })
  .passthrough();

export const SmartRecruitersPostingSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    uuid: z.string().optional(),
    refNumber: z.string().optional(),
    company: z
      .object({ identifier: z.string().optional(), name: z.string().optional() })
      .passthrough()
      .optional(),
    releasedDate: z.string().optional(),
    location: SRLocationSchema.optional(),
    department: SRNamedSchema.optional(),
    function: SRNamedSchema.optional(),
    industry: SRNamedSchema.optional(),
    typeOfEmployment: SRNamedSchema.optional(),
    experienceLevel: SRNamedSchema.optional(),
    ref: z.string().optional(),
    visibility: z.string().optional(),
    postingUrl: z.string().url().optional(),
    applyUrl: z.string().url().optional(),
    jobAd: z
      .object({
        sections: z.record(z.string(), z.unknown()).optional(),
        companyDescription: z.string().optional(),
        jobDescription: z.string().optional(),
        qualifications: z.string().optional(),
        additionalInformation: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type SmartRecruitersPosting = z.infer<typeof SmartRecruitersPostingSchema>;

export const SmartRecruitersResponseSchema = z
  .object({
    offset: z.number().optional(),
    limit: z.number().optional(),
    totalFound: z.number().optional(),
    content: z.array(SmartRecruitersPostingSchema),
  })
  .passthrough();

export interface SmartRecruitersAdapterOpts {
  /** Company identifiers to poll. Defaults to $SMARTRECRUITERS_COMPANY_IDS split on comma. */
  companyIds?: string[];
  /** Rows per request (SmartRecruiters max 100). */
  pageSize?: number;
  /** Hard page cap per company. Defaults 5. */
  maxPages?: number;
  /** Fetch each posting's detail for the full job-ad text. Defaults true. */
  fetchDetails?: boolean;
  /** Hard cap on detail calls per fetch to bound N+1 cost. Defaults 25. */
  maxDetails?: number;
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createSmartRecruitersAdapter(
  opts: SmartRecruitersAdapterOpts = {},
): JobSourceAdapter {
  const companyIds = opts.companyIds ?? envCompanyIds();
  const base = opts.baseUrl ?? SR_BASE;
  const pageSize = opts.pageSize ?? SMARTRECRUITERS_DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 5;
  const fetchDetails = opts.fetchDetails ?? true;
  const maxDetails = opts.maxDetails ?? SMARTRECRUITERS_DEFAULT_MAX_DETAILS;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [SR_HOST, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: SMARTRECRUITERS_SOURCE_NAME,
    name: 'SmartRecruiters',
    tier: 1,
    licenseHint: 'Public ATS postings API; per-listing rights owned by originating employer.',
    attribution:
      'Sourced via SmartRecruiters (smartrecruiters.com). Listings © their respective employers.',
    async fetch(): Promise<RawJob[]> {
      if (companyIds.length === 0) return [];
      const all: RawJob[] = [];
      let detailCalls = 0;
      for (const companyId of companyIds) {
        let offset = 0;
        for (let page = 0; page < maxPages; page += 1) {
          const url = `${base}/${encodeURIComponent(companyId)}/postings?limit=${pageSize}&offset=${offset}`;
          const body = await retry(() => fetchList(url, safeFetchOpts, companyId), {
            attempts: opts.retryAttempts ?? 3,
            baseMs: 500,
          });
          for (const posting of body.content) {
            let detail: SmartRecruitersPosting | null = null;
            if (fetchDetails && detailCalls < maxDetails) {
              detailCalls += 1;
              try {
                detail = await retry(
                  () => fetchDetail(base, companyId, posting.id, safeFetchOpts),
                  { attempts: opts.retryAttempts ?? 3, baseMs: 500 },
                );
              } catch {
                detail = null;
              }
            }
            const mapped = mapSmartRecruiters(posting, companyId, detail);
            if (mapped) all.push(mapped);
          }
          const total = body.totalFound;
          offset += body.content.length;
          if (body.content.length === 0 || (total !== undefined && offset >= total)) break;
        }
      }
      return all;
    },
  };
}

/** Default registry instance. Env-driven; empty company list → no network. */
export const smartRecruitersAdapter: JobSourceAdapter = createSmartRecruitersAdapter();

function envCompanyIds(): string[] {
  const raw = process.env.SMARTRECRUITERS_COMPANY_IDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchList(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  companyId: string,
): Promise<z.infer<typeof SmartRecruitersResponseSchema>> {
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`smartrecruiters ${companyId} fetch failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const parsed = SmartRecruitersResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('smartrecruiters', `company=${companyId} missing 'content'`);
  }
  return parsed.data;
}

async function fetchDetail(
  base: string,
  companyId: string,
  postingId: string,
  safeFetchOpts: AssertPublicUrlOptions,
): Promise<SmartRecruitersPosting> {
  const url = `${base}/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(postingId)}`;
  const res = await safeFetch(url, { headers: { accept: 'application/json' } }, safeFetchOpts);
  if (!res.ok) {
    const err = new Error(`smartrecruiters detail ${postingId} failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const parsed = SmartRecruitersPostingSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('smartrecruiters', `detail ${postingId} shape invalid`);
  }
  return parsed.data;
}

/** Exported for tests. Returns null if the row is unusable (missing id/name). */
export function mapSmartRecruiters(
  posting: SmartRecruitersPosting,
  companyId: string,
  detail: SmartRecruitersPosting | null = null,
): RawJob | null {
  if (!posting.id || !posting.name.trim()) return null;
  const merged = detail ?? posting;
  const canonical =
    merged.postingUrl ??
    posting.postingUrl ??
    `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${encodeURIComponent(posting.id)}`;
  if (!z.string().url().safeParse(canonical).success) return null;

  const loc = merged.location ?? posting.location;
  const location =
    loc?.fullLocation?.trim() ||
    [loc?.city, loc?.region, loc?.country].filter((s) => Boolean(s && s.trim())).join(', ') ||
    null;

  const postedRaw = merged.releasedDate ?? posting.releasedDate ?? null;
  const posted = postedRaw ? new Date(postedRaw) : null;

  const description = buildDescription(merged) || posting.name.trim();
  return {
    sourceId: `${companyId}:${posting.id}`.slice(0, 200),
    sourceName: SMARTRECRUITERS_SOURCE_NAME,
    canonicalUrl: canonical,
    title: posting.name.trim().slice(0, 300),
    company: (posting.company?.name ?? companyId).slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote: Boolean(loc?.remote),
    description: description.slice(0, 50_000),
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: { posting, detail },
  };
}

/** Flatten SmartRecruiters' `jobAd` (flat strings or `sections` map) into plain text. */
function buildDescription(posting: SmartRecruitersPosting): string {
  const ad = posting.jobAd;
  if (!ad) return '';
  const chunks: string[] = [];
  const sections = ad.sections;
  if (sections) {
    for (const value of Object.values(sections)) {
      if (typeof value === 'string') chunks.push(value);
      else if (value && typeof value === 'object' && 'text' in value) {
        const text = (value as { text?: unknown }).text;
        if (typeof text === 'string') chunks.push(text);
      }
    }
  }
  for (const flat of [ad.companyDescription, ad.jobDescription, ad.qualifications, ad.additionalInformation]) {
    if (typeof flat === 'string') chunks.push(flat);
  }
  return stripHtml(chunks.join('\n\n')).trim();
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const smartRecruitersRateLimit = RATE_LIMITS.smartrecruiters;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#xa0;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
