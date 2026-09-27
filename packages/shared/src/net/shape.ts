// Browser-safe URL shape checker. NO `node:*` imports so this module is safe
// to bundle into client code (Wave A-C2 originally used node:net.isIP, but
// that leaks node:dns/net into the browser bundle via schemas). Pure-JS
// regex-based IP detection stands in for `node:net.isIP*`.
//
// Runtime DNS resolution (`assertPublicUrl`) and `safeFetch` live in
// ./assert-public-url.ts and remain server-only.

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
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify(evt));
}

export function reject(url: string, reason: string, host?: string, ip?: string): never {
  audit(url, reason, host, ip);
  const detail: { url: string; reason: string; host?: string; ip?: string } = { url, reason };
  if (host !== undefined) detail.host = host;
  if (ip !== undefined) detail.ip = ip;
  throw new SsrfBlockedError(`URL rejected: ${reason}`, detail);
}

// Pure-JS IP detection (replaces node:net.isIP*). Regex-based; sufficient for
// the shape check use case (does not need to be as thorough as node:net which
// handles edge cases like scoped addresses).
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:)+:([0-9a-f]{1,4}:)*[0-9a-f]{0,4}|::([0-9a-f]{1,4}:)*[0-9a-f]{0,4}|::)$/i;

export function isIPv4(ip: string): boolean {
  return IPV4_RE.test(ip);
}

export function isIPv6(ip: string): boolean {
  return IPV6_RE.test(ip);
}

export function isIP(ip: string): 0 | 4 | 6 {
  if (isIPv4(ip)) return 4;
  if (isIPv6(ip)) return 6;
  return 0;
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const normalised = ip.toLowerCase();
  if (normalised === '::1') return true;
  if (normalised === '::' || normalised.startsWith('::ffff:')) {
    const v4 = normalised.split(':').pop();
    if (v4 && isIPv4(v4)) return isPrivateIPv4(v4);
    return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalised)) return true;
  return false;
}

export function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

/**
 * Synchronous shape check. Protocol + allowlist + IP-literal privacy. Browser-
 * safe (no `node:*`). Does NOT resolve DNS; a hostname whose A record points
 * at a private IP will pass this check. The full async `assertPublicUrl` must
 * still run before fetch() on the server.
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
  if (isIP(host) && isPrivateIP(host)) {
    reject(url, 'literal_private_ip', host, host);
  }
  return parsed;
}
