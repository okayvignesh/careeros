/**
 * Provider configuration field definitions + the pure presence resolver for the
 * job-source / search providers (P3 screen 56).
 *
 * These adapters used to read credentials straight from `process.env`. The DB
 * (`app_config`, key `provider_config:<id>`) is now the primary source, entered
 * in Settings → Search providers; env is kept only as a last-resort fallback so
 * existing installs and CI contract tests keep working.
 *
 * This module is intentionally dependency-free (no `@careeros/secrets`, no DB)
 * so both the API and the worker can resolve a provider's effective config from
 * the same definitions. Sealing/decrypting secrets stays in the callers.
 */

export type ProviderFieldKind = 'text' | 'csv' | 'select';

export interface ProviderFieldDef {
  /** Stable key inside the stored `values` / `secrets` maps. */
  name: string;
  /** Human label for the settings form. */
  label: string;
  /** Secret fields are sealed at rest and never returned by the API. */
  secret: boolean;
  /** A provider is `configured` only when every required field is present. */
  required: boolean;
  kind?: ProviderFieldKind;
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Env var read only as a fallback when the DB has no value for this field. */
  envVar?: string;
}

/** Stored shape of one `app_config` row (`provider_config:<id>`). */
export interface ProviderConfigShape {
  values: Record<string, string>;
  /** Field name → `enc:v1:...` ciphertext. Never leaves the server. */
  secrets: Record<string, string>;
}

/** Client-safe view. `values` holds non-secret fields only; `has` flags secrets. */
export interface ProviderConfigView {
  values: Record<string, string>;
  has: Record<string, boolean>;
  configured: boolean;
  missing: string[];
}

/**
 * Single source of truth for every configurable provider. Providers absent from
 * this map (none today — arbeitnow/remotive are present with no fields) are
 * treated as keyless and always configured.
 */
export const PROVIDER_CONFIG_DEFS: Readonly<Record<string, readonly ProviderFieldDef[]>> = {
  ashby: [
    {
      name: 'orgIds',
      label: 'Ashby org IDs',
      secret: false,
      required: true,
      kind: 'csv',
      envVar: 'ASHBY_ORG_IDS',
      placeholder: 'acme, globex',
      help: 'Comma-separated public Ashby board slugs.',
    },
  ],
  greenhouse: [
    {
      name: 'boardTokens',
      label: 'Greenhouse board tokens',
      secret: false,
      required: true,
      kind: 'csv',
      envVar: 'GREENHOUSE_BOARD_TOKENS',
      placeholder: 'acme, globex',
      help: 'Comma-separated public Greenhouse board tokens.',
    },
  ],
  lever: [
    {
      name: 'siteSlugs',
      label: 'Lever site slugs',
      secret: false,
      required: true,
      kind: 'csv',
      envVar: 'LEVER_SITE_SLUGS',
      placeholder: 'acme, globex',
      help: 'Comma-separated public Lever site slugs.',
    },
    {
      name: 'region',
      label: 'Lever region',
      secret: false,
      required: false,
      kind: 'select',
      options: ['us', 'eu'],
      envVar: 'LEVER_REGION',
      help: 'EU sites live on api.eu.lever.co; everything else uses the global host.',
    },
  ],
  smartrecruiters: [
    {
      name: 'companyIds',
      label: 'SmartRecruiters company IDs',
      secret: false,
      required: true,
      kind: 'csv',
      envVar: 'SMARTRECRUITERS_COMPANY_IDS',
      placeholder: 'acme, globex',
      help: 'Comma-separated public company identifiers.',
    },
  ],
  workable: [
    {
      name: 'accounts',
      label: 'Workable accounts',
      secret: false,
      required: true,
      kind: 'csv',
      envVar: 'WORKABLE_ACCOUNTS',
      placeholder: 'acme, globex',
      help: 'Comma-separated Workable subdomains/accounts.',
    },
  ],
  adzuna: [
    {
      name: 'appId',
      label: 'Adzuna app ID',
      secret: false,
      required: true,
      envVar: 'ADZUNA_APP_ID',
    },
    {
      name: 'appKey',
      label: 'Adzuna app key',
      secret: true,
      required: true,
      envVar: 'ADZUNA_APP_KEY',
    },
  ],
  firecrawl: [
    {
      name: 'apiKey',
      label: 'Firecrawl API key',
      secret: true,
      required: true,
      envVar: 'FIRECRAWL_API_KEY',
    },
  ],
  workday: [
    {
      name: 'host',
      label: 'Workday host',
      secret: false,
      required: true,
      envVar: 'WORKDAY_HOST',
      placeholder: 'acme.wd1.myworkdayjobs.com',
    },
    {
      name: 'tenant',
      label: 'Workday tenant',
      secret: false,
      required: true,
      envVar: 'WORKDAY_TENANT',
      placeholder: 'acme',
    },
    {
      name: 'site',
      label: 'Workday site',
      secret: false,
      required: true,
      envVar: 'WORKDAY_SITE',
      placeholder: 'ACME_Careers',
    },
  ],
  icims: [
    {
      name: 'customerId',
      label: 'iCIMS customer ID',
      secret: false,
      required: true,
      envVar: 'ICIMS_CUSTOMER_ID',
    },
    {
      name: 'apiUser',
      label: 'iCIMS API user',
      secret: false,
      required: true,
      envVar: 'ICIMS_API_USER',
    },
    {
      name: 'apiPassword',
      label: 'iCIMS API password',
      secret: true,
      required: true,
      envVar: 'ICIMS_API_PASSWORD',
    },
    {
      name: 'portalId',
      label: 'iCIMS portal ID',
      secret: false,
      required: false,
      envVar: 'ICIMS_PORTAL_ID',
      placeholder: 'jobs',
    },
  ],
  successfactors: [
    {
      name: 'apiHost',
      label: 'SuccessFactors API host',
      secret: false,
      required: true,
      envVar: 'SF_API_HOST',
      placeholder: 'api4.successfactors.com',
    },
    {
      name: 'companyId',
      label: 'SuccessFactors company ID',
      secret: false,
      required: true,
      envVar: 'SF_COMPANY_ID',
    },
    {
      name: 'apiUser',
      label: 'SuccessFactors API user',
      secret: false,
      required: true,
      envVar: 'SF_API_USER',
    },
    {
      name: 'apiPassword',
      label: 'SuccessFactors API password',
      secret: true,
      required: true,
      envVar: 'SF_API_PASSWORD',
    },
  ],
  arbeitnow: [],
  remotive: [],
};

export function providerFields(id: string): readonly ProviderFieldDef[] {
  return PROVIDER_CONFIG_DEFS[id] ?? [];
}

export function isKnownProvider(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG_DEFS, id);
}

export function providerFieldNames(id: string): Set<string> {
  return new Set(providerFields(id).map((f) => f.name));
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Effective view of one provider: DB value first, env only as a fallback for
 * that field. `configured` is true when every required field is present;
 * `missing` lists the required field names still absent. Secrets are never
 * copied into `values` — only their presence is exposed via `has`.
 */
export function resolveProviderConfig(
  id: string,
  stored: ProviderConfigShape | null,
  env: Readonly<Record<string, string | undefined>> = {},
): ProviderConfigView {
  const values: Record<string, string> = {};
  const has: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const field of providerFields(id)) {
    const storedValue = stored?.values?.[field.name];
    const storedSecret = stored?.secrets?.[field.name];
    const envValue = field.envVar ? env[field.envVar] : undefined;

    if (field.secret) {
      const present = isSet(storedSecret) || isSet(envValue);
      has[field.name] = present;
      if (field.required && !present) missing.push(field.name);
      continue;
    }

    const value = isSet(storedValue)
      ? storedValue!.trim()
      : isSet(envValue)
        ? envValue!.trim()
        : '';
    if (value) values[field.name] = value;
    if (field.required && !value) missing.push(field.name);
  }

  return { values, has, configured: missing.length === 0, missing };
}
