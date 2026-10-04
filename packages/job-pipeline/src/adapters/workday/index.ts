import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import { normalizeWorkplaceType, type JobSourceAdapter, type RawJob } from '../../types';
import { MalformedResponseError } from '../errors';

/**
 * Workday public career-site adapter (F5, owner decision U6).
 *
 * Workday has no documented public jobs API, but every customer career site is
 * served by the Candidate Experience (CXS) JSON surface:
 *   List:   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *   Detail: GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
 * with `Accept: application/json`. List rows are thin (title, externalPath,
 * locationsText, postedOn prose, bulletFields); the detail call is what yields
 * the full `jobDescription` and a real `startDate` — so `fetchDetails` defaults
 * on.
 *
 * Trust: ATS-adjacent. A public Workday board is high-signal but is not the
 * same as a recorded Ashby/Greenhouse contract, so the declared tier is 2
 * (aggregator) and `verified` must be set explicitly — once an operator
 * confirms this exact host/tenant/site is the employer's canonical board —
 * before it counts as tier 1 (VERIFIED ATS). Callers can equivalently promote
 * per run through `trustOrder({ tierOverrides: { workday: 1 } })`.
 *
 * ponytail: `total` saturates at 2000 upstream and late offsets return rows
 * past the end, so pagination stops on the first empty page OR `offset>=total`
 * OR `maxPages`. Default maxPages=5 bounds a sync to 100 rows; the scheduled
 * crawler (F8) owns broader budget/pacing.
 */

export const WORKDAY_SOURCE_NAME = 'workday';
export const WORKDAY_TRUST_TIER_UNVERIFIED = 'UNVERIFIED' as const;
export const WORKDAY_TRUST_TIER_VERIFIED = 'VERIFIED' as const;
export const WORKDAY_DEFAULT_PAGE_SIZE = 20;

const WorkdayJobPostingSchema = z
  .object({
    title: z.string().min(1),
    externalPath: z.string().min(1),
    locationsText: z.string().optional(),
    postedOn: z.string().optional(),
    remoteType: z.string().optional(),
    bulletFields: z.array(z.string()).optional(),
  })
  .passthrough();
export type WorkdayJobPosting = z.infer<typeof WorkdayJobPostingSchema>;

const WorkdayJobsResponseSchema = z
  .object({
    total: z.number(),
    jobPostings: z.array(WorkdayJobPostingSchema),
    facets: z.array(z.unknown()).optional(),
  })
  .passthrough();

const WorkdayDetailSchema = z
  .object({
    jobPostingInfo: z
      .object({
        title: z.string().optional(),
        jobDescription: z.string().optional(),
        location: z.string().optional(),
        postedOn: z.string().optional(),
        startDate: z.string().optional(),
        remoteType: z.string().optional(),
        jobPostingId: z.string().optional(),
        externalUrl: z.string().url().optional(),
      })
      .passthrough(),
    hiringOrganization: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
export type WorkdayDetail = z.infer<typeof WorkdayDetailSchema>;

export interface WorkdayAdapterOpts {
  /** Career-site host, e.g. `pvh.wd1.myworkdayjobs.com`. Defaults $WORKDAY_HOST. */
  host?: string;
  /** Workday tenant (subdomain), e.g. `pvh`. Defaults $WORKDAY_TENANT. */
  tenant?: string;
  /** Board site name, e.g. `PVH_Careers`. Defaults $WORKDAY_SITE. */
  site?: string;
  /** Locale segment used to build canonical apply URLs. Defaults `en-US`. */
  locale?: string;
  /** Optional keyword filter passed through to the list endpoint. */
  searchText?: string;
  /** Optional facet map passed through to the list endpoint. */
  appliedFacets?: Record<string, string[]>;
  /** Rows per list request (Workday max 20). Defaults 20. */
  pageSize?: number;
  /** Hard page cap per fetch. Defaults 5. */
  maxPages?: number;
  /** Fetch per-posting detail for the full description/startDate. Defaults true. */
  fetchDetails?: boolean;
  /** Operator confirmation that this board is canonical → tier 1. Defaults false. */
  verified?: boolean;
  /** Test hook: override the CXS base (must still be allowlisted). */
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
  now?: Date;
}

export function createWorkdayAdapter(opts: WorkdayAdapterOpts = {}): JobSourceAdapter {
  const host = (opts.host ?? process.env.WORKDAY_HOST ?? '').trim();
  const tenant = (opts.tenant ?? process.env.WORKDAY_TENANT ?? '').trim();
  const site = (opts.site ?? process.env.WORKDAY_SITE ?? '').trim();
  const locale = opts.locale ?? 'en-US';
  const pageSize = opts.pageSize ?? WORKDAY_DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 5;
  const fetchDetails = opts.fetchDetails ?? true;
  const verified = opts.verified ?? false;
  const apiBase = opts.baseUrl ?? `https://${host}/wday/cxs/${tenant}/${site}`;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [host, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: WORKDAY_SOURCE_NAME,
    name: 'Workday',
    tier: verified ? 1 : 2,
    licenseHint:
      'Public employer career site (U6-permitted). Listings © the originating employer.',
    attribution: 'Sourced from the employer’s public Workday career site.',
    async fetch(): Promise<RawJob[]> {
      if (!host || !tenant || !site) return [];
      const postings: WorkdayJobPosting[] = [];
      let offset = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const listParams: ListParams = {
          pageSize,
          offset,
          ...(opts.searchText ? { searchText: opts.searchText } : {}),
          ...(opts.appliedFacets ? { appliedFacets: opts.appliedFacets } : {}),
        };
        const body = await retry(() => fetchList(apiBase, listParams, safeFetchOpts), {
          attempts: opts.retryAttempts ?? 3,
          baseMs: 500,
        });
        postings.push(...body.jobPostings);
        offset += body.jobPostings.length;
        if (body.jobPostings.length === 0 || offset >= body.total) break;
      }

      const out: RawJob[] = [];
      for (const posting of postings) {
        let detail: WorkdayDetail | null = null;
        if (fetchDetails) {
          try {
            detail = await retry(
              () => fetchDetail(apiBase, posting.externalPath, safeFetchOpts),
              { attempts: opts.retryAttempts ?? 3, baseMs: 500 },
            );
          } catch {
            // List row still carries title/location/url; degrade rather than
            // lose the posting to one flaky detail request.
            detail = null;
          }
        }
        const ctx: WorkdayMapContext = {
          host,
          tenant,
          site,
          locale,
          ...(opts.now ? { now: opts.now } : {}),
        };
        const mapped = mapWorkday(posting, detail, ctx);
        if (mapped) out.push(mapped);
      }
      return out;
    },
  };
}

/** Default registry instance. Env-driven; unset host/tenant/site → no network. */
export const workdayAdapter: JobSourceAdapter = createWorkdayAdapter();

interface ListParams {
  pageSize: number;
  offset: number;
  searchText?: string;
  appliedFacets?: Record<string, string[]>;
}

async function fetchList(
  apiBase: string,
  params: ListParams,
  safeFetchOpts: AssertPublicUrlOptions,
): Promise<z.infer<typeof WorkdayJobsResponseSchema>> {
  const res = await safeFetch(
    `${apiBase}/jobs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        appliedFacets: params.appliedFacets ?? {},
        limit: params.pageSize,
        offset: params.offset,
        searchText: params.searchText ?? '',
      }),
    },
    safeFetchOpts,
  );
  if (!res.ok) throw httpError('workday', `list ${params.offset}`, res.status);
  const parsed = WorkdayJobsResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('workday', `list offset=${params.offset} shape invalid`);
  }
  return parsed.data;
}

async function fetchDetail(
  apiBase: string,
  externalPath: string,
  safeFetchOpts: AssertPublicUrlOptions,
): Promise<WorkdayDetail> {
  const res = await safeFetch(
    `${apiBase}${externalPath}`,
    { headers: { accept: 'application/json' } },
    safeFetchOpts,
  );
  if (!res.ok) throw httpError('workday', `detail ${externalPath}`, res.status);
  const parsed = WorkdayDetailSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('workday', `detail ${externalPath} shape invalid`);
  }
  return parsed.data;
}

function httpError(adapter: string, label: string, status: number): Error & { status: number } {
  const err = new Error(`[${adapter}] ${label} fetch failed: ${status}`) as Error & {
    status: number;
  };
  err.status = status;
  return err;
}

export interface WorkdayMapContext {
  host: string;
  tenant: string;
  site: string;
  locale: string;
  now?: Date;
}

/** Map a Workday list row (+ optional detail) to a `RawJob`. Exported for tests. */
export function mapWorkday(
  posting: WorkdayJobPosting,
  detail: WorkdayDetail | null,
  ctx: WorkdayMapContext,
): RawJob | null {
  const info = detail?.jobPostingInfo;
  const title = (info?.title ?? posting.title ?? '').trim();
  if (!title || !posting.externalPath) return null;

  const canonical =
    info?.externalUrl ?? `https://${ctx.host}/${ctx.locale}/${ctx.site}${posting.externalPath}`;
  if (!z.string().url().safeParse(canonical).success) return null;

  const html = info?.jobDescription ?? '';
  const plain = html ? stripHtml(html) : '';
  const description = (plain || title).slice(0, 50_000);
  const location = (info?.location ?? posting.locationsText ?? '').trim();
  const company = (detail?.hiringOrganization?.name ?? ctx.tenant).trim() || ctx.tenant;
  const key = info?.jobPostingId ?? posting.bulletFields?.[0] ?? posting.externalPath;

  return {
    sourceId: `${WORKDAY_SOURCE_NAME}:${ctx.tenant}:${ctx.site}:${key}`.slice(0, 200),
    sourceName: WORKDAY_SOURCE_NAME,
    canonicalUrl: canonical,
    title: title.slice(0, 300),
    company: company.slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote: inferWorkdayRemote(info?.remoteType ?? posting.remoteType, `${title} ${location} ${description}`),
    workplaceType: normalizeWorkplaceType(info?.remoteType ?? posting.remoteType) ?? null,
    description,
    sourcePostedAt: parseWorkdayPosted(info?.startDate, posting.postedOn, ctx.now ?? new Date()),
    fetchedAt: new Date(),
    payload: { posting, detail },
  };
}

/**
 * Workday reports `remoteType` (`Remote` / `Flex` / `Onsite`) on most boards.
 * Flex = hybrid, not remote, so only an explicit `Remote` wins; otherwise fall
 * back to a text heuristic.
 */
export function inferWorkdayRemote(remoteType: string | undefined, haystack: string): boolean {
  if (remoteType) {
    const t = remoteType.toLowerCase();
    if (t.includes('remote')) return true;
    if (t.includes('onsite') || t.includes('on-site') || t.includes('flex')) return false;
  }
  return /remote|anywhere|worldwide|work from home|\bwfh\b/i.test(haystack);
}

/**
 * `startDate` is a real ISO date; `postedOn` is localized prose ("Posted Today",
 * "Posted 30+ Days Ago"). Prefer the former, fall back to prose. Unknown → null
 * (freshness/verify treat null as "no signal", never as stale).
 */
export function parseWorkdayPosted(
  startDate: string | undefined,
  postedOn: string | undefined,
  now: Date = new Date(),
): Date | null {
  if (startDate) {
    const d = new Date(startDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!postedOn) return null;
  const text = postedOn.toLowerCase();
  if (postedOn.trim() === '') return null;
  if (/posted\s+today/.test(text)) return now;
  if (/posted\s+yesterday/.test(text)) return new Date(now.getTime() - 86_400_000);
  const m = text.match(/posted\s+(\d+)\+?\s+days?\s+ago/);
  if (m?.[1]) return new Date(now.getTime() - Number(m[1]) * 86_400_000);
  return null;
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const workdayRateLimit = RATE_LIMITS.workday;

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
