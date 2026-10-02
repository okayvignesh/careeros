/**
 * Firecrawl configuration. The key is read from `FIRECRAWL_API_KEY` (operator
 * env / settings-ready); it is never logged and never baked into a default.
 *
 * A missing key is not a boot-time failure: callers ask `isFirecrawlConfigured`
 * or catch `FirecrawlConfigError` from the client constructor and treat the
 * source as unavailable. User-entered keys can later be injected through the
 * existing `EncryptedSecret`/`ProviderConfig` path (F4-F8) via `apiKey`.
 */

export const FIRECRAWL_API_KEY_ENV = 'FIRECRAWL_API_KEY';

/** Returns the trimmed key, or `null` when unset/blank. Never logs its value. */
export function readFirecrawlApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[FIRECRAWL_API_KEY_ENV];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when a usable key is present. Settings/UI use this to gate the source. */
export function isFirecrawlConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readFirecrawlApiKey(env) !== null;
}
