// Field-level encryption helpers. Wrap `encrypt`/`decrypt` from encryption.ts with
// a version marker so:
//   - Reads are backwards-compatible: existing plaintext rows pass through unchanged.
//   - Writes are idempotent: encrypting an already-encrypted value is a no-op (no
//     wrapper-of-a-wrapper).
//   - Migrations don't need a coordinated backfill; encrypted rows grow lazily as
//     the api reads then writes them.
//
// Marker: `enc:v1:<subkeyPurpose>:<base64ciphertext>`. Purpose is echoed so future
// key-rotation can identify which subkey to use for decrypt.
import { decrypt, deriveSubkey, encrypt } from './encryption';

const MARKER = 'enc:v1:';

/** True if the value is already an encrypted field-level ciphertext produced by us. */
export function isEncryptedField(value: string): boolean {
  return value.startsWith(MARKER);
}

/**
 * Encrypt a plaintext field value. Deterministic in structure, non-deterministic in
 * ciphertext (fresh IV per call). If `plaintext` already carries our marker, returned
 * as-is so `encryptField(encryptField(x))` === `encryptField(x)`.
 */
export function encryptField(plaintext: string, master: Buffer, purpose: string): string {
  if (isEncryptedField(plaintext)) return plaintext;
  // The marker parser splits on the first `:` after `enc:v1:`, so `purpose` must
  // itself never contain one. Cheap up-front check beats a mysterious decrypt error.
  if (purpose.includes(':')) {
    throw new Error(`purpose must not contain ':' (got '${purpose}')`);
  }
  const sub = deriveSubkey(master, `field:${purpose}`);
  const ct = encrypt(plaintext, sub, `field:${purpose}`);
  return `${MARKER}${purpose}:${ct}`;
}

/**
 * Decrypt a field value. If `value` isn't one of ours (no marker), returns it as-is
 * so pre-encryption rows still read. If the marker's embedded purpose disagrees with
 * the caller's, throws — a ciphertext-swap attempt across fields.
 */
export function decryptField(value: string, master: Buffer, purpose: string): string {
  if (!isEncryptedField(value)) return value;
  const rest = value.slice(MARKER.length);
  const sepIdx = rest.indexOf(':');
  if (sepIdx < 0) throw new Error('malformed encrypted field: missing purpose separator');
  const embeddedPurpose = rest.slice(0, sepIdx);
  const ct = rest.slice(sepIdx + 1);
  if (embeddedPurpose !== purpose) {
    throw new Error(
      `field ciphertext purpose mismatch: got '${embeddedPurpose}', expected '${purpose}'`,
    );
  }
  const sub = deriveSubkey(master, `field:${purpose}`);
  return decrypt(ct, sub, `field:${purpose}`);
}
