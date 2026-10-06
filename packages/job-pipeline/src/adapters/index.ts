import type { JobSourceAdapter } from '../types';
import { remotiveAdapter } from './remotive';
import { ashbyAdapter } from './ashby';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { smartRecruitersAdapter } from './smartrecruiters';
import { workableAdapter } from './workable';
import { adzunaAdapter } from './adzuna';
import { arbeitnowAdapter } from './arbeitnow';
import { firecrawlAdapter } from './firecrawl';
import { workdayAdapter } from './workday';
import { icimsAdapter } from './icims';
import { successFactorsAdapter } from './successfactors';

/**
 * All shipped adapters in registry order. Callers (jobs.service.ts) build a
 * `{[id]: adapter}` map from this list — adding a new adapter is a one-line
 * append here.
 *
 * Adapter env requirements (throw MissingCredentialError at fetch time, not
 * import time, if unset):
 *   - adzuna: ADZUNA_APP_ID, ADZUNA_APP_KEY
 *   - ashby (default instance): ASHBY_ORG_IDS (comma-separated slugs)
 *   - greenhouse (default instance): GREENHOUSE_BOARD_TOKENS (comma-separated)
 *   - lever: LEVER_SITE_SLUGS (comma-separated; optional LEVER_REGION=eu)
 *   - smartrecruiters: SMARTRECRUITERS_COMPANY_IDS (comma-separated)
 *   - workable: WORKABLE_ACCOUNTS (comma-separated slugs)
 *   - icims: ICIMS_CUSTOMER_ID, ICIMS_API_USER, ICIMS_API_PASSWORD
 *            (+ ICIMS_PORTAL_ID, default `jobs`)
 *   - successfactors: SF_API_HOST, SF_COMPANY_ID, SF_API_USER, SF_API_PASSWORD
 *   - arbeitnow / remotive: none
 *   - firecrawl: FIRECRAWL_API_KEY (+ FIRECRAWL_JOB_QUERIES, else no network)
 *   - workday: WORKDAY_HOST, WORKDAY_TENANT, WORKDAY_SITE (else no network)
 */
export const adapters: readonly JobSourceAdapter[] = [
  ashbyAdapter,
  greenhouseAdapter,
  leverAdapter,
  smartRecruitersAdapter,
  workableAdapter,
  adzunaAdapter,
  arbeitnowAdapter,
  remotiveAdapter,
  firecrawlAdapter,
  workdayAdapter,
  icimsAdapter,
  successFactorsAdapter,
];

export {
  createAshbyAdapter,
  ashbyAdapter,
  mapAshby,
  type AshbyJob,
  type AshbyAdapterOpts,
} from './ashby';
export {
  createGreenhouseAdapter,
  greenhouseAdapter,
  mapGreenhouse,
  type GreenhouseJob,
  type GreenhouseAdapterOpts,
} from './greenhouse';
export {
  createLeverAdapter,
  leverAdapter,
  mapLever,
  inferLeverRemote,
  leverRateLimit,
  LEVER_SOURCE_NAME,
  LEVER_DEFAULT_PAGE_SIZE,
  type LeverPosting,
  type LeverAdapterOpts,
} from './lever';
export {
  createSmartRecruitersAdapter,
  smartRecruitersAdapter,
  mapSmartRecruiters,
  smartRecruitersRateLimit,
  SMARTRECRUITERS_SOURCE_NAME,
  SMARTRECRUITERS_DEFAULT_PAGE_SIZE,
  SMARTRECRUITERS_DEFAULT_MAX_DETAILS,
  type SmartRecruitersPosting,
  type SmartRecruitersAdapterOpts,
} from './smartrecruiters';
export {
  createWorkableAdapter,
  workableAdapter,
  mapWorkable,
  workableRateLimit,
  WORKABLE_SOURCE_NAME,
  WORKABLE_DEFAULT_MAX_JOBS,
  type WorkableJob,
  type WorkableAdapterOpts,
} from './workable';
export {
  createIcimsAdapter,
  icimsAdapter,
  mapIcims,
  titleFromPortalUrl,
  parseIcimsDate,
  icimsRateLimit,
  ICIMS_SOURCE_NAME,
  ICIMS_TRUST_TIER_UNVERIFIED,
  ICIMS_TRUST_TIER_VERIFIED,
  ICIMS_DEFAULT_PORTAL_ID,
  ICIMS_DEFAULT_PAGE_SIZE,
  type IcimsAdapterOpts,
  type IcimsSearchResult,
} from './icims';
export {
  createSuccessFactorsAdapter,
  successFactorsAdapter,
  mapSuccessFactors,
  successFactorsRateLimit,
  SUCCESSFACTORS_SOURCE_NAME,
  SUCCESSFACTORS_TRUST_TIER_UNVERIFIED,
  SUCCESSFACTORS_TRUST_TIER_VERIFIED,
  SUCCESSFACTORS_DEFAULT_PAGE_SIZE,
  type SuccessFactorsAdapterOpts,
  type SuccessFactorsJob,
  type SuccessFactorsMapContext,
} from './successfactors';
export {
  createAdzunaAdapter,
  adzunaAdapter,
  mapAdzuna,
  type AdzunaJob,
  type AdzunaAdapterOpts,
} from './adzuna';
export {
  createArbeitnowAdapter,
  arbeitnowAdapter,
  mapArbeitnow,
  type ArbeitnowJob,
  type ArbeitnowAdapterOpts,
} from './arbeitnow';
export { remotiveAdapter, mapRemotive, type RemotiveJob } from './remotive';
export {
  createFirecrawlAdapter,
  firecrawlAdapter,
  mapFirecrawl,
  marketRequest,
  isBannedPlatformUrl,
  companyFromUrl,
  firecrawlRateLimit,
  FIRECRAWL_TRUST_TIER,
  FIRECRAWL_SOURCE_NAME,
  type FirecrawlAdapterOpts,
  type FirecrawlJobClient,
  type FirecrawlMarketScope,
} from './firecrawl';
export {
  createWorkdayAdapter,
  workdayAdapter,
  mapWorkday,
  parseWorkdayPosted,
  inferWorkdayRemote,
  workdayRateLimit,
  WORKDAY_SOURCE_NAME,
  WORKDAY_TRUST_TIER_UNVERIFIED,
  WORKDAY_TRUST_TIER_VERIFIED,
  WORKDAY_DEFAULT_PAGE_SIZE,
  type WorkdayAdapterOpts,
  type WorkdayJobPosting,
  type WorkdayDetail,
  type WorkdayMapContext,
} from './workday';
export {
  AdapterError,
  MalformedResponseError,
  MissingCredentialError,
} from './errors';
