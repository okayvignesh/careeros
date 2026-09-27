const WEAK_SET = new Set([
  '',
  'changeme',
  'REPLACE_ME_WITH_openssl_rand_hex_32',
  '00000000000000000000000000000000',
  '0'.repeat(64),
]);

/** Refuses to start on weak or missing key. Called during startup-check before Nest bootstrap. */
export function assertStrongKey(name: string, value: string | undefined, minBytes = 32): void {
  if (!value || WEAK_SET.has(value.trim())) {
    throw new Error(
      `${name} is missing or set to a known-weak value. Generate one with: openssl rand -hex 32`,
    );
  }
  const bytes = value.length >= 64 ? Buffer.from(value, 'hex').length : Buffer.byteLength(value);
  if (bytes < minBytes) {
    throw new Error(`${name} is too short (${bytes} bytes). Need at least ${minBytes} bytes.`);
  }
}

const HEX64_RE = /^[0-9a-f]{64}$/;
const BASE64_44_RE = /^[A-Za-z0-9+/]{43}=$/;
const MASTER_KEY_ERROR =
  'ENCRYPTION_KEY must be 64 hex chars or 44 base64 chars (32 bytes). Generate: openssl rand -hex 32';

/**
 * A-H4: strict decoder. Rejects short / non-hex / non-base64 inputs instead of the
 * old null-pad fallback, which silently discarded entropy (a 12-char passphrase would
 * boot with an all-zero tail as its AES key). The two accepted encodings both carry
 * exactly 32 bytes; anything else is a configuration error, not something to guess at.
 *
 * The weak-set check from `assertStrongKey` is inlined so all rejections speak with
 * one voice; the more permissive `assertStrongKey` stays available for callers whose
 * secret is not a fixed-format key (e.g. SESSION_SECRET which iron-session hashes).
 */
export function loadMasterKey(env = process.env.ENCRYPTION_KEY): Buffer {
  const raw = (env ?? '').trim();
  if (!raw || WEAK_SET.has(raw)) {
    throw new Error(
      `ENCRYPTION_KEY is missing or set to a known-weak value. Generate one with: openssl rand -hex 32`,
    );
  }
  if (HEX64_RE.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  if (BASE64_44_RE.test(raw)) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error(MASTER_KEY_ERROR);
    return buf;
  }
  throw new Error(MASTER_KEY_ERROR);
}
