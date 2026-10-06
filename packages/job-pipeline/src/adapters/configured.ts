import type { JobSourceAdapter } from '../types';
import { createAdzunaAdapter } from './adzuna';
import { createAshbyAdapter } from './ashby';
import { createFirecrawlAdapter } from './firecrawl';
import { createGreenhouseAdapter } from './greenhouse';
import { createIcimsAdapter } from './icims';
import { createLeverAdapter } from './lever';
import { createSmartRecruitersAdapter } from './smartrecruiters';
import { createSuccessFactorsAdapter } from './successfactors';
import { createWorkableAdapter } from './workable';
import { createWorkdayAdapter } from './workday';

/** Decrypted config for one provider, as resolved from the DB (+ env fallback). */
export interface ProviderCredentials {
  values: Record<string, string>;
  secrets: Record<string, string>;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function str(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** True when the record has at least one non-empty string value. */
function hasAnyValue(rec: Record<string, string> | undefined): boolean {
  return Object.values(rec ?? {}).some((x) => typeof x === 'string' && x.trim().length > 0);
}

/**
 * Build a configured adapter instance from stored credentials using the same
 * `create*Adapter(opts)` factories the registry uses. Returns null for an
 * unknown/keyless provider OR when no credentials are stored, so the caller
 * keeps its default (env-reading) instance — passing an empty array option
 * would otherwise suppress the factory's env/default fallback. Empty strings
 * are never forwarded.
 */
export function createConfiguredAdapter(
  id: string,
  cfg: ProviderCredentials,
): JobSourceAdapter | null {
  const v = cfg.values ?? {};
  const s = cfg.secrets ?? {};
  if (!hasAnyValue(v) && !hasAnyValue(s)) return null;

  switch (id) {
    case 'ashby':
      return createAshbyAdapter({ orgIds: csv(v.orgIds) });
    case 'greenhouse':
      return createGreenhouseAdapter({ boardTokens: csv(v.boardTokens) });
    case 'lever':
      return createLeverAdapter({
        sites: csv(v.siteSlugs),
        region: str(v.region) === 'eu' ? 'eu' : 'global',
      });
    case 'smartrecruiters':
      return createSmartRecruitersAdapter({ companyIds: csv(v.companyIds) });
    case 'workable':
      return createWorkableAdapter({ accounts: csv(v.accounts) });
    case 'adzuna': {
      const appId = str(v.appId);
      const appKey = str(s.appKey);
      return createAdzunaAdapter({
        ...(appId || appKey ? { credentials: { ...(appId ? { appId } : {}), ...(appKey ? { appKey } : {}) } } : {}),
      });
    }
    case 'firecrawl': {
      const apiKey = str(s.apiKey);
      return createFirecrawlAdapter({ ...(apiKey ? { apiKey } : {}) });
    }
    case 'workday': {
      const host = str(v.host);
      const tenant = str(v.tenant);
      const site = str(v.site);
      return createWorkdayAdapter({
        ...(host ? { host } : {}),
        ...(tenant ? { tenant } : {}),
        ...(site ? { site } : {}),
      });
    }
    case 'icims': {
      const customerId = str(v.customerId);
      const portalId = str(v.portalId);
      const user = str(v.apiUser);
      const password = str(s.apiPassword);
      return createIcimsAdapter({
        ...(customerId ? { customerId } : {}),
        ...(portalId ? { portalId } : {}),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
      });
    }
    case 'successfactors': {
      const apiHost = str(v.apiHost);
      const companyId = str(v.companyId);
      const user = str(v.apiUser);
      const password = str(s.apiPassword);
      return createSuccessFactorsAdapter({
        ...(apiHost ? { apiHost } : {}),
        ...(companyId ? { companyId } : {}),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
      });
    }
    default:
      return null;
  }
}
