import { assertPublicUrlShape, safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';

// Hostnames that are only ever a *local* model runtime. These are the same
// names shared/net's DEV_ONLY_HOSTS recognises; unlike the external SSRF path
// we deliberately permit them because Ollama is BY DEFINITION on the host/VPN
// and never holds a public DNS record. Production still refuses http://localhost
// for external providers through `safeFetch` + NODE_ENV checks.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'ollama']);

export interface ProviderFetchOptions {
  allowlist?: string[] | undefined;
  /** Permit loopback/`ollama` hosts (local model runtimes only). */
  allowLocal?: boolean | undefined;
  lookup?: AssertPublicUrlOptions['lookup'];
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

async function localFetch(
  url: string,
  init: RequestInit,
  allowlist: string[] | undefined,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    // Shape check (no DNS): blocks non-allowlisted hosts and literal private
    // IPs, but intentionally allows the loopback names Ollama lives on.
    assertPublicUrlShape(current, allowlist ? { allowlist } : {});
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const next = res.headers.get('location');
    if (!next) return res;
    current = new URL(next, current).toString();
  }
  throw new Error('too many redirects');
}

/**
 * SSRF-safe fetch for provider adapters. External providers always go through
 * shared/net's `safeFetch` (DNS + private-IP rejection). Local adapters opt in
 * via `allowLocal` and get the loopback-only shape-checked path instead.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  opts: ProviderFetchOptions = {},
): Promise<Response> {
  if (opts.allowLocal && LOCAL_HOSTS.has(hostOf(url))) {
    return localFetch(url, init, opts.allowlist);
  }
  return safeFetch(url, init, {
    ...(opts.allowlist ? { allowlist: opts.allowlist } : {}),
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
  });
}
