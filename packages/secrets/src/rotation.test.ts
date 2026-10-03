// Master-key rotation primitive. All cases run without a DB: the function is a
// pure transform over a stored ciphertext string plus two keys.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt } from './encryption';
import { decryptField, encryptField } from './field';
import { rotateMasterKey, type RotateContext } from './rotation';

const oldKey = randomBytes(32);
const newKey = randomBytes(32);
const wrongKey = randomBytes(32);

const secretCtx = (ciphertext: string, purpose = 'provider:deepseek:apiKey'): RotateContext => ({
  kind: 'secret',
  ciphertext,
  context: purpose,
});

const fieldCtx = (ciphertext: string, column = 'content'): RotateContext => ({
  kind: 'field',
  ciphertext,
  context: column,
});

describe('rotateMasterKey (raw secret)', () => {
  it('round-trip: old decrypts before, new decrypts after, old no longer does', () => {
    const ct = encrypt('sk-live-123', oldKey, 'provider:deepseek:apiKey');
    const res = rotateMasterKey(oldKey, newKey, secretCtx(ct));
    expect(res.status).toBe('rotated');
    expect(res.ciphertext).not.toBe(ct); // fresh IV
    expect(decrypt(res.ciphertext, newKey, 'provider:deepseek:apiKey')).toBe('sk-live-123');
    expect(() => decrypt(res.ciphertext, oldKey, 'provider:deepseek:apiKey')).toThrow();
  });

  it('is idempotent: rotating twice is safe and second call is a skip', () => {
    const ct = encrypt('token', oldKey, 'integration:github:token');
    const once = rotateMasterKey(oldKey, newKey, secretCtx(ct, 'integration:github:token'));
    const twice = rotateMasterKey(oldKey, newKey, secretCtx(once.ciphertext, 'integration:github:token'));
    expect(twice.status).toBe('already-rotated');
    expect(twice.ciphertext).toBe(once.ciphertext);
    expect(decrypt(twice.ciphertext, newKey, 'integration:github:token')).toBe('token');
  });

  it('wrong keys: neither old nor new decrypts -> throws, value untouched', () => {
    const ct = encrypt('secret', oldKey, 'p');
    expect(() => rotateMasterKey(wrongKey, randomBytes(32), secretCtx(ct, 'p'))).toThrow(
      /refusing to rotate/,
    );
  });

  it('AAD context mismatch (purpose swap) is treated as undecryptable', () => {
    const ct = encrypt('secret', oldKey, 'provider:openai:apiKey');
    expect(() =>
      rotateMasterKey(oldKey, newKey, secretCtx(ct, 'provider:deepseek:apiKey')),
    ).toThrow(/refusing to rotate/);
  });
});

describe('rotateMasterKey (field marker)', () => {
  it('round-trip re-encrypts a field ciphertext under the new key', () => {
    const ct = encryptField('resume bullet', oldKey, 'content');
    const res = rotateMasterKey(oldKey, newKey, fieldCtx(ct));
    expect(res.status).toBe('rotated');
    expect(res.ciphertext.startsWith('enc:v1:content:')).toBe(true);
    expect(decryptField(res.ciphertext, newKey, 'content')).toBe('resume bullet');
    expect(() => decryptField(res.ciphertext, oldKey, 'content')).toThrow();
  });

  it('leaves legacy plaintext field values untouched (status plaintext)', () => {
    const res = rotateMasterKey(oldKey, newKey, fieldCtx('not encrypted yet'));
    expect(res).toEqual({ status: 'plaintext', ciphertext: 'not encrypted yet' });
  });

  it('is idempotent on field markers', () => {
    const ct = encryptField('x', oldKey, 'snippet');
    const once = rotateMasterKey(oldKey, newKey, fieldCtx(ct, 'snippet'));
    const twice = rotateMasterKey(oldKey, newKey, fieldCtx(once.ciphertext, 'snippet'));
    expect(twice.status).toBe('already-rotated');
    expect(twice.ciphertext).toBe(once.ciphertext);
  });

  it('wrong keys on a field marker throw instead of silently passing it through', () => {
    const ct = encryptField('x', oldKey, 'content');
    expect(() => rotateMasterKey(wrongKey, randomBytes(32), fieldCtx(ct))).toThrow(
      /refusing to rotate/,
    );
  });
});
