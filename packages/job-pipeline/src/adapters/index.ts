import type { JobSourceAdapter } from '../types';
import { remotiveAdapter } from './remotive';
import { ashbyAdapter } from './ashby';
import { greenhouseAdapter } from './greenhouse';
import { adzunaAdapter } from './adzuna';
import { arbeitnowAdapter } from './arbeitnow';

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
 */
export const adapters: readonly JobSourceAdapter[] = [
  ashbyAdapter,
  greenhouseAdapter,
  adzunaAdapter,
  arbeitnowAdapter,
  remotiveAdapter,
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
  AdapterError,
  MalformedResponseError,
  MissingCredentialError,
} from './errors';
