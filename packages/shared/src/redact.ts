// Redact secrets from strings before logging. Additive: new patterns land here.
const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'session_secret',
  'encryption_key',
  'deepseek_api_key',
]);

const PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /xoxb-[A-Za-z0-9-]{20,}/g,
];

export function redact<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === 'string') return applyPatterns(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out as T;
  }
  return value;
}

function applyPatterns(s: string): string {
  let out = s;
  for (const p of PATTERNS) out = out.replace(p, '[REDACTED]');
  return out;
}
