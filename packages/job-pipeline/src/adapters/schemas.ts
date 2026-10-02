import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z, type ZodTypeAny } from 'zod';

/**
 * Wire-shape Zod schemas per adapter (C-P3.6a).
 *
 * These describe the SUBSET of upstream response fields each mapper reads.
 * Purpose:
 *   1. Contract tests (`*.contract.test.ts`) validate live upstream JSON
 *      against these schemas. A drift = a schema fail = a caught regression
 *      instead of silently-dropped mapper output.
 *   2. Snapshot files under `__contracts__/` are the last-known-good subset;
 *      the workflow diffs incoming payloads against them.
 *
 * Rules:
 *   - Every field the mapper touches MUST appear here.
 *   - `.passthrough()` — upstream is free to add fields; only the ones we read
 *     matter for drift.
 *   - No dependency on the mapper. If you change a mapper to read a new field,
 *     add it here too.
 *
 * ponytail: these schemas are NOT wired into the mapper hot path — that would
 * be a pre-parse the mapper doesn't need (it already null-guards). Upgrade
 * path: use `.safeParse()` in the fetch step if we ever want robust
 * upstream-shape rejection at ingest time.
 */

// ---------- Remotive ----------
export const RemotiveJobWire = z
  .object({
    id: z.number(),
    url: z.string().url(),
    title: z.string().min(1),
    company_name: z.string().min(1),
    candidate_required_location: z.string(),
    publication_date: z.string(),
    description: z.string(),
    job_type: z.string().optional(),
    salary: z.string().optional(),
    category: z.string().optional(),
  })
  .passthrough();

export const RemotiveFeedWire = z
  .object({
    jobs: z.array(RemotiveJobWire),
  })
  .passthrough();

// ---------- Ashby ----------
export const AshbyJobWire = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    location: z.string(),
    isRemote: z.boolean().optional(),
    descriptionHtml: z.string().optional(),
    descriptionPlain: z.string().optional(),
    publishedAt: z.string().optional(),
    jobUrl: z.string().url(),
    employmentType: z.string().optional(),
    team: z.string().optional(),
    department: z.string().optional(),
    compensation: z.unknown().optional(),
  })
  .passthrough();

export const AshbyBoardWire = z
  .object({
    apiVersion: z.string().optional(),
    jobs: z.array(AshbyJobWire),
  })
  .passthrough();

// ---------- Greenhouse ----------
export const GreenhouseJobWire = z
  .object({
    id: z.number(),
    internal_job_id: z.number().optional(),
    title: z.string().min(1),
    updated_at: z.string().optional(),
    requisition_id: z.string().optional(),
    location: z
      .object({ name: z.string().optional() })
      .passthrough()
      .optional(),
    absolute_url: z.string().url(),
    content: z.string().optional(),
    metadata: z.unknown().optional(),
    company_name: z.string().optional(),
    first_published: z.string().optional(),
    departments: z
      .array(z.object({ name: z.string() }).passthrough())
      .optional(),
    offices: z
      .array(
        z
          .object({
            name: z.string(),
            // Greenhouse returns null (not undefined) when the office is remote-only.
            location: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export const GreenhouseBoardWire = z
  .object({
    jobs: z.array(GreenhouseJobWire),
    meta: z
      .object({ total: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---------- Adzuna ----------
export const AdzunaJobWire = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    redirect_url: z.string().url(),
    company: z
      .object({ display_name: z.string().optional() })
      .passthrough()
      .optional(),
    location: z
      .object({
        display_name: z.string().optional(),
        area: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    created: z.string().optional(),
    category: z
      .object({ label: z.string().optional(), tag: z.string().optional() })
      .passthrough()
      .optional(),
    contract_type: z.string().optional(),
    contract_time: z.string().optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    salary_is_predicted: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .passthrough();

export const AdzunaResponseWire = z
  .object({
    results: z.array(AdzunaJobWire),
    count: z.number().optional(),
    mean: z.number().optional(),
  })
  .passthrough();

// ---------- Arbeitnow ----------
export const ArbeitnowJobWire = z
  .object({
    slug: z.string().min(1),
    company_name: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    remote: z.boolean(),
    url: z.string().url(),
    tags: z.array(z.string()).optional(),
    job_types: z.array(z.string()).optional(),
    location: z.string().optional(),
    created_at: z.number().optional(),
  })
  .passthrough();

export const ArbeitnowResponseWire = z
  .object({
    data: z.array(ArbeitnowJobWire),
    meta: z.unknown().optional(),
  })
  .passthrough();

// ---------- Workday (public career-site CXS API) ----------
// List: POST /wday/cxs/{tenant}/{site}/jobs -> { total, jobPostings, facets }.
// `total` saturates at 2000 upstream; callers must stop on an empty page too.
export const WorkdayJobPostingWire = z
  .object({
    title: z.string().min(1),
    externalPath: z.string().min(1),
    locationsText: z.string().optional(),
    postedOn: z.string().optional(),
    remoteType: z.string().optional(),
    bulletFields: z.array(z.string()).optional(),
  })
  .passthrough();

export const WorkdayJobsWire = z
  .object({
    total: z.number(),
    jobPostings: z.array(WorkdayJobPostingWire),
    facets: z.array(z.unknown()).optional(),
  })
  .passthrough();

// Detail: GET /wday/cxs/{tenant}/{site}{externalPath} with Accept: application/json.
export const WorkdayJobPostingInfoWire = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    jobDescription: z.string().optional(),
    location: z.string().optional(),
    postedOn: z.string().optional(),
    startDate: z.string().optional(),
    timeType: z.string().optional(),
    jobReqId: z.string().optional(),
    jobPostingId: z.string().optional(),
    jobPostingSiteId: z.string().optional(),
    externalUrl: z.string().url().optional(),
    remoteType: z.string().optional(),
    country: z.object({ descriptor: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const WorkdayDetailWire = z
  .object({
    jobPostingInfo: WorkdayJobPostingInfoWire,
    hiringOrganization: z.object({ name: z.string().optional() }).passthrough().optional(),
    userAuthenticated: z.boolean().optional(),
  })
  .passthrough();

// ---------- Firecrawl (v1 search response subset) ----------
// Mirrors packages/firecrawl/src/schemas.ts. Kept local so this test-time
// registry has no runtime dependency on the client package.
export const FirecrawlSearchResultWire = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    markdown: z.string().optional(),
    html: z.string().optional(),
    links: z.array(z.string()).optional(),
    metadata: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        sourceURL: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const FirecrawlSearchResponseWire = z
  .object({
    success: z.literal(true),
    data: z.array(FirecrawlSearchResultWire),
  })
  .passthrough();

// ---------- Lever (public Postings API v0) ----------
// `GET /v0/postings/{site}?mode=json` returns a bare JSON array of postings.
export const LeverPostingWire = z
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
    country: z.string().optional(),
    workplaceType: z.string().optional(),
    salaryRange: z.unknown().optional(),
  })
  .passthrough();

export const LeverBoardWire = z.array(LeverPostingWire);

// ---------- SmartRecruiters (public Posting API v1) ----------
// `GET /v1/companies/{companyId}/postings` -> { offset, limit, totalFound, content }.
export const SmartRecruitersPostingWire = z
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
    location: z
      .object({
        city: z.string().optional(),
        region: z.string().optional(),
        country: z.string().optional(),
        remote: z.boolean().optional(),
        hybrid: z.boolean().optional(),
        fullLocation: z.string().optional(),
      })
      .passthrough()
      .optional(),
    department: z.unknown().optional(),
    function: z.unknown().optional(),
    industry: z.unknown().optional(),
    typeOfEmployment: z.unknown().optional(),
    experienceLevel: z.unknown().optional(),
    ref: z.string().optional(),
    visibility: z.string().optional(),
    postingUrl: z.string().url().optional(),
    applyUrl: z.string().url().optional(),
    jobAd: z.unknown().optional(),
  })
  .passthrough();

export const SmartRecruitersResponseWire = z
  .object({
    offset: z.number().optional(),
    limit: z.number().optional(),
    totalFound: z.number().optional(),
    content: z.array(SmartRecruitersPostingWire),
  })
  .passthrough();

// ---------- Workable (public jobs widget) ----------
// `GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true`.
export const WorkableJobWire = z
  .object({
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
    locations: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const WorkableBoardWire = z
  .object({
    name: z.string().optional(),
    description: z.string().nullish(),
    jobs: z.array(WorkableJobWire),
  })
  .passthrough();

// ---------- iCIMS (partner Job Portal API) ----------
// `GET /customers/{customerId}/search/portals/{portalId}` -> { searchResults }.
export const IcimsSearchResultWire = z
  .object({
    id: z.union([z.number(), z.string()]),
    portalUrl: z.string().url(),
    self: z.string().url().optional(),
    updatedDate: z.string().optional(),
    jobtitle: z.string().optional(),
    jobTitle: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    joblocation: z.string().optional(),
  })
  .passthrough();

export const IcimsSearchResponseWire = z
  .object({
    searchResults: z.array(IcimsSearchResultWire),
  })
  .passthrough();

// ---------- SuccessFactors (tenant OData v2 JobRequisition) ----------
// `GET /odata/v2/JobRequisition?$top=&$skip=&$format=json` -> { d: { results } }.
export const SuccessFactorsJobWire = z
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

export const SuccessFactorsResponseWire = z
  .object({
    d: z.object({ results: z.array(SuccessFactorsJobWire) }).passthrough(),
  })
  .passthrough();

/**
 * Registry of adapter wire schemas. The workflow / snapshot regeneration walks
 * this map so a new adapter is one entry, not a new script.
 */
export const adapterWireSchemas = {
  remotive: RemotiveFeedWire,
  ashby: AshbyBoardWire,
  greenhouse: GreenhouseBoardWire,
  adzuna: AdzunaResponseWire,
  arbeitnow: ArbeitnowResponseWire,
  workday: WorkdayJobsWire,
  firecrawl: FirecrawlSearchResponseWire,
  lever: LeverBoardWire,
  smartrecruiters: SmartRecruitersResponseWire,
  workable: WorkableBoardWire,
  icims: IcimsSearchResponseWire,
  successfactors: SuccessFactorsResponseWire,
} as const;

export type AdapterId = keyof typeof adapterWireSchemas;

// ---------------------------------------------------------------------------
// Contract-test machinery (used by *.contract.test.ts). Not re-exported from
// the package `index.ts` — this is test-time only and pulls `node:fs`, so we
// keep it colocated with the schemas but off the public API surface.
// ---------------------------------------------------------------------------

export const shouldRunContract = (): boolean =>
  process.env.ADAPTER_CONTRACT === '1';

export const shouldUpdateSnapshots = (): boolean =>
  process.env.UPDATE_SNAPSHOTS === '1';

const CONTRACTS_DIR = join(__dirname, '..', '..', '__contracts__');

export function snapshotPath(adapterId: string): string {
  return join(CONTRACTS_DIR, `${adapterId}.snapshot.json`);
}

/**
 * Reduce a full upstream payload to a SHAPE snapshot: for the first row of
 * jobs/results/data, replace every leaf value with its type tag. Values churn
 * daily (job titles, descriptions); the type tree is the stable contract we
 * want to track. A snapshot diff only fires when a FIELD is renamed, dropped,
 * or type-flipped — real drift signals, not content noise.
 *
 * Example: `{ id: 42, title: "foo" }` -> `{ id: "number", title: "string" }`.
 */
export function minimizePayload(
  raw: unknown,
  jobsKey: 'jobs' | 'results' | 'data' | 'jobPostings' | 'content' | 'searchResults',
): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const arr = obj[jobsKey];
  const firstRow =
    Array.isArray(arr) && arr.length > 0 ? [shapeOf(arr[0])] : [];
  const out: Record<string, unknown> = { [jobsKey]: firstRow };
  for (const k of Object.keys(obj)) {
    if (k === jobsKey) continue;
    out[k] = shapeOf(obj[k]);
  }
  return out;
}

/**
 * Recursively map values to their type tags. Preserves object keys + array
 * membership; strips string/number/boolean values so daily churn doesn't move
 * the snapshot. Null stays null (missing vs null is a real contract signal).
 */
function shapeOf(v: unknown): unknown {
  if (v === null) return null;
  if (Array.isArray(v)) return v.length === 0 ? [] : [shapeOf(v[0])];
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = shapeOf((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return typeof v;
}

export function readSnapshot(adapterId: string): unknown | null {
  const p = snapshotPath(adapterId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function writeSnapshot(adapterId: string, minimized: unknown): void {
  const p = snapshotPath(adapterId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(minimized, null, 2) + '\n', 'utf8');
}

/**
 * Validate a live payload against the wire schema. Throws with adapter + field
 * path on failure. Test harness converts this into a "drift detected" report.
 */
export function assertWireShape<S extends ZodTypeAny>(
  adapterId: string,
  schema: S,
  payload: unknown,
): z.infer<S> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Upstream drift detected for adapter=${adapterId}. Wire schema failed:\n${issues}`,
    );
  }
  return result.data;
}
