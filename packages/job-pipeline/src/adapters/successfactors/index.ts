import { retry, RATE_LIMITS } from '@careeros/shared';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { z } from 'zod';
import type { JobSourceAdapter, RawJob } from '../../types';
import { MalformedResponseError, MissingCredentialError } from '../errors';

/**
 * SAP SuccessFactors Recruiting adapter (F6, owner decision U6).
 *
 * Public postings live on Career Site Builder pages whose internal JSON shape
 * varies by data center/site, so the documented, stable surface is the
 * tenant-gated OData v2 `JobRequisition` entity:
 *   `GET https://{apiHost}/odata/v2/JobRequisition?$top={n}&$skip={s}&$format=json&$select=...`
 * with HTTP Basic auth `{userId}@{companyId}:{password}` and Recruiter-Operator
 * permissions (see SAP Help "OData API" and developers.sap.com).
 *
 * Trust: tenant-gated (not a keyless first-party ATS board), so the declared
 * tier is 2 (like Workday) and `verified` must be set explicitly — once an
 * operator confirms the tenant is the employer's canonical recruiting instance
 * — before it counts as tier 1 (VERIFIED ATS).
 *
 * ponytail: `$skip`/`$top` pagination stops on the first short page. The
 * canonical apply URL prefers the configured public career-site host and falls
 * back to a job path on the API host when none is given.
 */

export const SUCCESSFACTORS_SOURCE_NAME = 'successfactors';
export const SUCCESSFACTORS_TRUST_TIER_UNVERIFIED = 'UNVERIFIED' as const;
export const SUCCESSFACTORS_TRUST_TIER_VERIFIED = 'VERIFIED' as const;
export const SUCCESSFACTORS_DEFAULT_PAGE_SIZE = 100;

const SF_ODATA_PATH = '/odata/v2/JobRequisition';
const SF_SELECT =
  'jobReqId,jobTitle,jobDescription,location,jobType,createdDateTime,lastModifiedDateTime,status';

export const SuccessFactorsJobSchema = z
  .object({
    jobReqId: z.union([z.string(), z.number()]),
    jobTitle: z.string().optional(),
    jobDescription: z.string().optional(),
    location: z.string().optional(),
    jobType: z.string().optional(),
    createdDateTime: z.string().optional(),
    lastModifiedDateTime: z.string().optional(),
    status: z.string().optional(),
    jobCode: z.string().optional(),
  })
  .passthrough();
export type SuccessFactorsJob = z.infer<typeof SuccessFactorsJobSchema>;

export const SuccessFactorsResponseSchema = z
  .object({
    d: z
      .object({
        results: z.array(SuccessFactorsJobSchema),
      })
      .passthrough(),
  })
  .passthrough();

export interface SuccessFactorsAdapterOpts {
  /** OData host, e.g. `api4.successfactors.com`. Defaults $SF_API_HOST. */
  apiHost?: string;
  /** Company/tenant id. Defaults $SF_COMPANY_ID. */
  companyId?: string;
  /** Basic-auth user id (without the `@companyId` suffix). Defaults $SF_API_USER. */
  user?: string;
  /** Basic-auth password. Defaults $SF_API_PASSWORD. */
  password?: string;
  /** Public career-site base for canonical apply URLs. Defaults $SF_CAREER_SITE_URL. */
  careerSiteUrl?: string;
  /** Employer display name. Defaults $SF_COMPANY_NAME or the company id. */
  companyName?: string;
  /** Rows per request. Defaults 100. */
  pageSize?: number;
  /** Hard page cap per fetch. Defaults 5. */
  maxPages?: number;
  /** Operator confirmation that this tenant is canonical → tier 1. Defaults false. */
  verified?: boolean;
  /** Test hook: override the API base (must still be allowlisted). */
  baseUrl?: string;
  allowlist?: string[];
  lookup?: AssertPublicUrlOptions['lookup'];
  retryAttempts?: number;
  nodeEnv?: string;
}

export function createSuccessFactorsAdapter(
  opts: SuccessFactorsAdapterOpts = {},
): JobSourceAdapter {
  const apiHost = (opts.apiHost ?? process.env.SF_API_HOST ?? '').trim();
  const companyId = (opts.companyId ?? process.env.SF_COMPANY_ID ?? '').trim();
  const user = opts.user ?? process.env.SF_API_USER ?? '';
  const password = opts.password ?? process.env.SF_API_PASSWORD ?? '';
  const careerSiteUrl = (opts.careerSiteUrl ?? process.env.SF_CAREER_SITE_URL ?? '').trim();
  const companyName = (opts.companyName ?? process.env.SF_COMPANY_NAME ?? companyId).trim();
  const pageSize = opts.pageSize ?? SUCCESSFACTORS_DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 5;
  const verified = opts.verified ?? false;
  const base = opts.baseUrl ?? `https://${apiHost}`;
  const safeFetchOpts: AssertPublicUrlOptions = {
    allowlist: [apiHost, ...(opts.allowlist ?? [])],
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  };

  return {
    id: SUCCESSFACTORS_SOURCE_NAME,
    name: 'SuccessFactors',
    tier: verified ? 1 : 2,
    licenseHint:
      'Employer career site via the tenant OData API (U6-permitted). Listings © the originating employer.',
    attribution: 'Sourced from the employer’s public SAP SuccessFactors career site.',
    async fetch(): Promise<RawJob[]> {
      if (!apiHost || !companyId) return [];
      const missing: string[] = [];
      if (!user) missing.push('SF_API_USER');
      if (!password) missing.push('SF_API_PASSWORD');
      if (missing.length > 0) throw new MissingCredentialError(SUCCESSFACTORS_SOURCE_NAME, missing);

      const out: RawJob[] = [];
      let skip = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const url = `${base}${SF_ODATA_PATH}?$top=${pageSize}&$skip=${skip}&$format=json&$select=${SF_SELECT}`;
        const body = await retry(
          () => fetchPage(url, safeFetchOpts, user, password, companyId),
          { attempts: opts.retryAttempts ?? 3, baseMs: 500 },
        );
        for (const row of body.d.results) {
          const mapped = mapSuccessFactors(row, companyId, {
            ...(apiHost ? { apiHost } : {}),
            ...(careerSiteUrl ? { careerSiteUrl } : {}),
            ...(companyName ? { companyName } : {}),
          });
          if (mapped) out.push(mapped);
        }
        skip += body.d.results.length;
        if (body.d.results.length === 0 || body.d.results.length < pageSize) break;
      }
      return out;
    },
  };
}

/** Default registry instance. Env-driven; unset host/company → no network. */
export const successFactorsAdapter: JobSourceAdapter = createSuccessFactorsAdapter();

async function fetchPage(
  url: string,
  safeFetchOpts: AssertPublicUrlOptions,
  user: string,
  password: string,
  companyId: string,
): Promise<z.infer<typeof SuccessFactorsResponseSchema>> {
  const auth = Buffer.from(`${user}@${companyId}:${password}`, 'utf8').toString('base64');
  const res = await safeFetch(
    url,
    { headers: { accept: 'application/json', authorization: `Basic ${auth}` } },
    safeFetchOpts,
  );
  if (!res.ok) {
    const err = new Error(`successfactors tenant=${companyId} fetch failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const parsed = SuccessFactorsResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new MalformedResponseError('successfactors', `tenant=${companyId} missing 'd.results'`);
  }
  return parsed.data;
}

export interface SuccessFactorsMapContext {
  apiHost?: string;
  careerSiteUrl?: string;
  companyName?: string;
}

/** Exported for tests. Returns null if the row is unusable (no jobReqId). */
export function mapSuccessFactors(
  row: SuccessFactorsJob,
  companyId: string,
  ctx: SuccessFactorsMapContext = {},
): RawJob | null {
  const reqId = row.jobReqId;
  if (reqId === undefined || reqId === null || `${reqId}`.trim() === '') return null;
  const id = String(reqId).trim();
  const title = (row.jobTitle ?? '').trim() || `Requisition ${id}`;

  const site = (ctx.careerSiteUrl ?? '').replace(/\/+$/, '');
  const canonical = site
    ? `${site}/job/${encodeURIComponent(id)}/`
    : `https://${ctx.apiHost ?? companyId}/job/${encodeURIComponent(id)}`;
  if (!z.string().url().safeParse(canonical).success) return null;

  const postedRaw = row.createdDateTime ?? row.lastModifiedDateTime ?? null;
  const posted = postedRaw ? new Date(postedRaw) : null;
  const location = row.location?.trim() || null;
  const description = stripHtml(row.jobDescription ?? '').trim() || title;

  return {
    sourceId: `${companyId}:${id}`.slice(0, 200),
    sourceName: SUCCESSFACTORS_SOURCE_NAME,
    canonicalUrl: canonical,
    title: title.slice(0, 300),
    company: (ctx.companyName?.trim() || companyId).slice(0, 200),
    location: location ? location.slice(0, 200) : null,
    remote: /remote|virtual|anywhere|worldwide/i.test(`${title} ${location ?? ''}`),
    description: description.slice(0, 50_000),
    sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    fetchedAt: new Date(),
    payload: row,
  };
}

/** Rationale documented rate ceiling; workers use this when sizing queues. */
export const successFactorsRateLimit = RATE_LIMITS.successfactors;

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
