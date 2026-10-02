import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypt a plaintext string with AES-256-GCM. Output layout:
 *   base64( iv(12) || tag(16) || ciphertext )
 * Context binds the ciphertext to a domain (prevents ciphertext swap across field types).
 */
export function encrypt(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(ciphertext: string, key: Buffer, context: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Derive a purpose-specific 32-byte subkey from the master via HKDF-SHA256. */
export function deriveSubkey(master: Buffer, purpose: string): Buffer {
  const derived = hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(purpose, 'utf8'), 32);
  return Buffer.from(derived);
}
