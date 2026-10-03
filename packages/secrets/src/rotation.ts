// Master-key rotation primitive. Re-encrypts one stored ciphertext from an old
// master key to a new one. Pure + DB-free so the API's row-walking service can
// call it inside its own per-row transaction and tests can exercise the
// semantics (round-trip, idempotency, failure) without Postgres.
//
// Two shapes of ciphertext live in the codebase and both are covered here:
//   - 'secret': raw AES-256-GCM output stored in `encrypted_secrets.ciphertext`.
//     Its AAD context is the row's `purpose` column.
//   - 'field':  an `enc:v1:<purpose>:<b64>` field marker written by
//     `encryptField`. Its AAD context is the column name.
//
// Idempotency (required so a failed run can be resumed): if the old key can't
// decrypt but the new key can, the value is treated as already rotated and
// returned verbatim. If NEITHER key decrypts, we throw and the caller stops,
// leaving the operator on the old key.
import { decrypt, encrypt } from './encryption';
import { decryptField, encryptField, isEncryptedField } from './field';

/** Which storage shape the ciphertext is in. */
export type RotateKind = 'secret' | 'field';

export interface RotateContext {
  kind: RotateKind;
  /** Ciphertext exactly as stored. For 'field', a plaintext legacy value is allowed. */
  ciphertext: string;
  /** AES-GCM AAD context: `encrypted_secrets.purpose`, or the field column name. */
  context: string;
}

export type RotateStatus = 'rotated' | 'already-rotated' | 'plaintext';

export interface RotateResult {
  status: RotateStatus;
  /** New stored value. Equals the input for 'already-rotated' and 'plaintext'. */
  ciphertext: string;
}

/**
 * Re-encrypt `ctx.ciphertext` from `oldKey` to `newKey`.
 *
 * - `rotated`:        decrypted with oldKey, re-encrypted with newKey.
 * - `already-rotated`: newKey decrypts and oldKey does not (safe to skip).
 * - `plaintext`:      field value without our marker (legacy row; left alone).
 *
 * Throws if neither key decrypts the ciphertext: corrupt data, a ciphertext
 * from a third key, or a purpose/AAD mismatch. Callers MUST treat that as a
 * hard stop so the operator does not discard the old key.
 */
export function rotateMasterKey(
  oldKey: Buffer,
  newKey: Buffer,
  ctx: RotateContext,
): RotateResult {
  if (ctx.kind === 'field' && !isEncryptedField(ctx.ciphertext)) {
    return { status: 'plaintext', ciphertext: ctx.ciphertext };
  }

  const withOld = tryDecrypt(oldKey, ctx);
  if (withOld != null) {
    return { status: 'rotated', ciphertext: reencrypt(withOld, newKey, ctx) };
  }

  const withNew = tryDecrypt(newKey, ctx);
  if (withNew != null) {
    return { status: 'already-rotated', ciphertext: ctx.ciphertext };
  }

  throw new Error(
    `cannot decrypt ${ctx.kind} with old or new master key (context='${ctx.context}') — refusing to rotate so the operator keeps the old key`,
  );
}

function tryDecrypt(key: Buffer, ctx: RotateContext): string | null {
  try {
    return ctx.kind === 'field'
      ? decryptField(ctx.ciphertext, key, ctx.context)
      : decrypt(ctx.ciphertext, key, ctx.context);
  } catch {
    return null;
  }
}

function reencrypt(plaintext: string, key: Buffer, ctx: RotateContext): string {
  return ctx.kind === 'field'
    ? encryptField(plaintext, key, ctx.context)
    : encrypt(plaintext, key, ctx.context);
}
