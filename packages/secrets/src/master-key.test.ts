import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadMasterKey } from './master-key';

// A-H4: loadMasterKey MUST reject anything other than 64-char lowercase hex
// or 44-char base64 that decodes to 32 bytes. The old null-pad branch (which
// silently zero-padded short passphrases into a 32-byte "key") is gone.

describe('A-H4 loadMasterKey (strict)', () => {
  const validHex = randomBytes(32).toString('hex');
  const validBase64 = randomBytes(32).toString('base64');

  it('accepts 64-char lowercase hex and decodes to 32 bytes', () => {
    const key = loadMasterKey(validHex);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(validHex, 'hex'))).toBe(true);
  });

  it('accepts 44-char base64 and decodes to 32 bytes', () => {
    // randomBytes(32).toString('base64') is always 44 chars with a trailing '='.
    expect(validBase64.length).toBe(44);
    expect(validBase64.endsWith('=')).toBe(true);
    const key = loadMasterKey(validBase64);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(validBase64, 'base64'))).toBe(true);
  });

  it('rejects empty', () => {
    // Passing `''` bypasses the default-parameter fallback to process.env.
    // Explicit undefined would fall back to the vitest.setup ENCRYPTION_KEY,
    // so exercise the empty-string path directly instead.
    expect(() => loadMasterKey('')).toThrow(/missing or set to a known-weak/);
    expect(() => loadMasterKey('   ')).toThrow(/missing or set to a known-weak/);
  });

  it('rejects a short (8-char) hex string — old null-pad path is unreachable', () => {
    // Pre-fix behaviour: `'deadbeef'.padEnd(32, '\0')` silently produced a
    // 32-byte buffer with 24 null bytes. Post-fix it throws.
    expect(() => loadMasterKey('deadbeef')).toThrow(/64 hex chars or 44 base64 chars/);
  });

  it('rejects 63-char hex (off-by-one)', () => {
    const short = validHex.slice(0, 63);
    expect(short.length).toBe(63);
    expect(() => loadMasterKey(short)).toThrow(/64 hex chars or 44 base64 chars/);
  });

  it('rejects 65-char hex (off-by-one the other way)', () => {
    const long = validHex + 'a';
    expect(long.length).toBe(65);
    expect(() => loadMasterKey(long)).toThrow(/64 hex chars or 44 base64 chars/);
  });

  it('rejects 64-char string with non-hex characters', () => {
    const notHex = 'z'.repeat(64);
    expect(() => loadMasterKey(notHex)).toThrow(/64 hex chars or 44 base64 chars/);
  });

  it('rejects 44-char string that is not valid base64', () => {
    const notB64 = '!'.repeat(43) + '=';
    expect(notB64.length).toBe(44);
    expect(() => loadMasterKey(notB64)).toThrow(/64 hex chars or 44 base64 chars/);
  });

  it('rejects a random 20-char passphrase (the exact class the null-pad branch used to accept)', () => {
    expect(() => loadMasterKey('supersecretpassword!')).toThrow();
  });

  it('rejects a known-weak sentinel', () => {
    // assertStrongKey catches this before the format check ever runs.
    expect(() => loadMasterKey('changeme')).toThrow(/known-weak/);
    expect(() => loadMasterKey('0'.repeat(64))).toThrow(/known-weak/);
  });

  it('error message names the fix (openssl rand -hex 32)', () => {
    expect(() => loadMasterKey('nope')).toThrow(/openssl rand -hex 32/);
  });

  // MUTATION SMOKE:
  //   - Bring back `Buffer.from(value.padEnd(32, '\0').slice(0, 32), 'utf8')`
  //     → "rejects short 8-char hex" + "rejects random 20-char passphrase" fail.
  //   - Loosen HEX64_RE to `/^[0-9a-f]+$/i` → "rejects 63-char hex" +
  //     "rejects 65-char hex" fail.
  //   - Loosen BASE64_44_RE to accept any length → "rejects 44-char string that
  //     is not valid base64" and the 20-char passphrase test both fail.
});
