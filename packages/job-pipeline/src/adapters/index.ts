import type { JobSourceAdapter } from '../types';
import { remotiveAdapter } from './remotive';
import { ashbyAdapter } from './ashby';
import { greenhouseAdapter } from './greenhouse';
import { adzunaAdapter } from './adzuna';
import { arbeitnowAdapter } from './arbeitnow';
import { firecrawlAdapter } from './firecrawl';
import { workdayAdapter } from './workday';

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
 *   - arbeitnow / remotive: none
 *   - firecrawl: FIRECRAWL_API_KEY (+ FIRECRAWL_JOB_QUERIES, else no network)
 *   - workday: WORKDAY_HOST, WORKDAY_TENANT, WORKDAY_SITE (else no network)
 */
export const adapters: readonly JobSourceAdapter[] = [
  ashbyAdapter,
  greenhouseAdapter,
  adzunaAdapter,
  arbeitnowAdapter,
  remotiveAdapter,
  firecrawlAdapter,
  workdayAdapter,
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
  isBannedPlatformUrl,
  companyFromUrl,
  firecrawlRateLimit,
  FIRECRAWL_TRUST_TIER,
  FIRECRAWL_SOURCE_NAME,
  type FirecrawlAdapterOpts,
  type FirecrawlJobClient,
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
