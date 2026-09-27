// Server-only SSRF guard. Re-exports the browser-safe shape checker from
// ./shape, and adds `assertPublicUrl` (async, uses node:dns) + `safeFetch`.
//
// Rules (see plan/_audit_security.md#C2):
//   1. HTTPS required in production. `NODE_ENV !== 'production'` allows http
//      for localhost + ollama only.
//   2. Host must appear in the allowlist. Pass a custom allowlist to extend
//      the defaults for a self-hosted GitLab / dossier feed.
//   3. DNS-resolve the host (all A/AAAA records) and reject any resolved IP
//      in RFC1918, link-local, loopback, or IPv6 ULA / link-local space.
//   4. Callers using this URL for fetch() must pass `redirect: 'manual'` and
//      re-validate the `Location` header on 3xx. `safeFetch` below does both.
//
// Every rejection emits a `security.audit.ssrf_rejected` warn on the shared
// audit hook so a downstream can aggregate the events.
import { promises as dns } from 'node:dns';
import {
  DEFAULT_ALLOWLIST,
  SsrfBlockedError,
  assertPublicUrlShape,
  isIP,
  isIPv4,
  isPrivateIP,
  reject,
  setSsrfAuditHook,
  type AssertPublicUrlOptions,
} from './shape';

const DEV_ONLY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'ollama']);

// Re-exports so callers of `@careeros/shared/net` continue to work.
export {
  DEFAULT_ALLOWLIST,
  SsrfBlockedError,
  assertPublicUrlShape,
  isIP,
  isIPv4,
  isPrivateIP,
  setSsrfAuditHook,
  type AssertPublicUrlOptions,
};

async function defaultLookup(
  host: string,
): Promise<Array<{ address: string; family: number }>> {
  return dns.lookup(host, { all: true });
}

/**
 * Validate a URL is safe to fetch server-side. Throws SsrfBlockedError on any
 * rule violation; every rejection is audit-logged. Returns the parsed URL on
 * success so callers can reuse it without re-parsing.
 */
export async function assertPublicUrl(
  url: string,
  opts: AssertPublicUrlOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    reject(url, 'invalid_url');
  }

  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const proto = parsed.protocol;

  if (proto !== 'https:' && proto !== 'http:') {
    reject(url, 'unsupported_protocol', parsed.hostname);
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  const allowlist = new Set([...DEFAULT_ALLOWLIST, ...(opts.allowlist ?? [])]);
  if (!allowlist.has(host)) {
    reject(url, 'host_not_allowlisted', host);
  }

  if (isProd) {
    if (proto !== 'https:') {
      reject(url, 'plaintext_in_production', host);
    }
    if (DEV_ONLY_HOSTS.has(host)) {
      reject(url, 'dev_only_host_in_production', host);
    }
  }

  const lookup = opts.lookup ?? defaultLookup;
  let records: Array<{ address: string; family: number }>;
  if (isIP(host)) {
    records = [{ address: host, family: isIPv4(host) ? 4 : 6 }];
  } else {
    try {
      records = await lookup(host);
    } catch {
      reject(url, 'dns_lookup_failed', host);
    }
  }

  if (records.length === 0) {
    reject(url, 'dns_no_records', host);
  }

  for (const rec of records) {
    if (isPrivateIP(rec.address)) {
      reject(url, 'resolved_to_private_ip', host, rec.address);
    }
  }

  return parsed;
}

/**
 * Fetch wrapper: validates the URL first, forces `redirect: 'manual'`, and on
 * 3xx re-validates the Location header before following. Follows at most 3
 * hops to stop redirect loops.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: AssertPublicUrlOptions = {},
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current, opts);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const next = res.headers.get('location');
    if (!next) return res;
    current = new URL(next, current).toString();
  }
  reject(url, 'too_many_redirects');
}
