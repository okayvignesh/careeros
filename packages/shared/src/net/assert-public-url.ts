// SSRF guard for any URL an authenticated user can feed to server-side code (LLM
// baseUrl, embedding baseUrl, self-hosted GitLab, dossier fetcher, etc.). Rejects
// anything that could pivot to the metadata service, a Docker service on the
// internal bridge, or the operator's LAN.
//
// Rules (see plan/_audit_security.md#C2):
//   1. HTTPS required in production. `NODE_ENV !== 'production'` allows http for
//      localhost + ollama only.
//   2. Host must appear in the allowlist. Pass a custom allowlist to extend the
//      defaults for a self-hosted GitLab / dossier feed.
//   3. DNS-resolve the host (all A/AAAA records) and reject any resolved IP in
//      RFC1918, link-local, loopback, or IPv6 ULA / link-local space. Catches
//      allowlisted hosts that briefly point at a private IP.
//   4. Callers using this URL for fetch() must pass `redirect: 'manual'` and
//      re-validate the `Location` header on 3xx. `safeFetch` below does both.
//
// Every rejection emits a `security.audit.ssrf_rejected` warn on the shared
// audit hook so a downstream can aggregate the events.
import { promises as dns } from 'node:dns';
import { isIP, isIPv4, isIPv6 } from 'node:net';

export interface AssertPublicUrlOptions {
  /** Extra hostnames allowed in addition to the defaults. Exact match. */
  allowlist?: string[];
  /** Override NODE_ENV check. Tests use this to force production semantics. */
  nodeEnv?: string;
  /** Injectable DNS resolver so tests do not hit the network. */
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export const DEFAULT_ALLOWLIST = [
  'api.deepseek.com',
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'localhost',
  '127.0.0.1',
  '::1',
  'ollama',
  'api.github.com',
  'gitlab.com',
];

// Hosts that are legitimate in dev but must not be reachable in production
// even when the operator adds them to the allowlist.
const DEV_ONLY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'ollama']);

export class SsrfBlockedError extends Error {
  readonly code = 'security.audit.ssrf_rejected';
  constructor(
    message: string,
    readonly detail: { url: string; reason: string; host?: string; ip?: string },
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

interface AuditEvent {
  code: string;
  url: string;
  reason: string;
  host: string | undefined;
  ip: string | undefined;
}
type AuditHook = (event: AuditEvent) => void;

let auditHook: AuditHook | null = null;

/** Register a callback for every SSRF rejection. Idempotent; last writer wins. */
export function setSsrfAuditHook(hook: AuditHook | null): void {
  auditHook = hook;
}

function audit(url: string, reason: string, host?: string, ip?: string): void {
  const evt: AuditEvent = { code: 'security.audit.ssrf_rejected', url, reason, host, ip };
  try {
    auditHook?.(evt);
  } catch {
    /* audit must never throw */
  }
  // ponytail: console.warn is the fallback until a shared pino logger exists in
  // packages/*. Replace with the logger once packages/shared/logger lands.
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify(evt));
}

function reject(url: string, reason: string, host?: string, ip?: string): never {
  audit(url, reason, host, ip);
  const detail: { url: string; reason: string; host?: string; ip?: string } = { url, reason };
  if (host !== undefined) detail.host = host;
  if (ip !== undefined) detail.ip = ip;
  throw new SsrfBlockedError(`URL rejected: ${reason}`, detail);
}

// RFC1918 / loopback / link-local / CGNAT IPv4 checks. Kept explicit so the
// reasoning is auditable at a glance.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed = treat as private (fail closed)
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalised = ip.toLowerCase();
  if (normalised === '::1') return true; // loopback
  if (normalised === '::' || normalised.startsWith('::ffff:')) {
    // IPv4-mapped: extract embedded v4
    const v4 = normalised.split(':').pop();
    if (v4 && isIPv4(v4)) return isPrivateIPv4(v4);
    return true;
  }
  // fc00::/7 (ULA) matches fc.. and fd..
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/.test(normalised)) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unrecognised = fail closed
}

async function defaultLookup(
  host: string,
): Promise<Array<{ address: string; family: number }>> {
  return dns.lookup(host, { all: true });
}

/**
 * Synchronous shape check. Cheaper first pass for Zod pipes and other
 * request-validation layers: protocol + allowlist + IP-literal privacy. Does
 * NOT resolve DNS; a hostname whose A record points at a private IP will pass
 * this check. The full async `assertPublicUrl` must still run before fetch().
 */
export function assertPublicUrlShape(
  url: string,
  opts: Omit<AssertPublicUrlOptions, 'lookup'> = {},
): URL {
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
  // Reject IP-literal targets pointing at private space (169.254.x, 10.x, etc).
  if (isIP(host) && isPrivateIP(host)) {
    reject(url, 'literal_private_ip', host, host);
  }
  return parsed;
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

  // DNS resolve. If the host is already a literal IP, isIP() returns non-zero
  // and dns.lookup would still work but adds a round trip; skip it.
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
