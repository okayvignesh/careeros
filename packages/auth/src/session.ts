import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Session cookie sealing. AES-256-GCM with a key derived from SESSION_SECRET.
 * Layout: base64url( iv(12) || tag(16) || ciphertext ).
 */
export interface Session {
  userId: string;
  createdAt: number;
  expiresAt: number;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function derive(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function seal(session: Session, secret: string): string {
  const key = derive(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

export function unseal(sealed: string, secret: string): Session | null {
  try {
    const key = derive(secret);
    const buf = Buffer.from(sealed, 'base64url');
    if (buf.length < IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const session = JSON.parse(plaintext) as Session;
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
