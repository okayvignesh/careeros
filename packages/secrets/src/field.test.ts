// backlog:#19 - real vitest cases (was demo-wrapper).
// Matches the master-key.test.ts pattern: one `it()` per assertion. Same 8
// scenarios the field.demo.ts self-check exercises, so `pnpm test` reports
// them individually and a broken scenario names itself in the failure line.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptField, encryptField, isEncryptedField } from './field';

const master = randomBytes(32);
const otherMaster = randomBytes(32);

describe('field encryption (per-purpose HKDF, AES-GCM)', () => {
  it('round-trip: encryptField -> decryptField returns the original', () => {
    const plain = 'This is a resume bullet with a company name.';
    const ct = encryptField(plain, master, 'content');
    expect(isEncryptedField(ct)).toBe(true);
    expect(ct.startsWith('enc:v1:content:')).toBe(true);
    expect(decryptField(ct, master, 'content')).toBe(plain);
  });

  it('idempotent: encrypting an already-encrypted value returns it verbatim', () => {
    const plain = 'hello';
    const once = encryptField(plain, master, 'content');
    const twice = encryptField(once, master, 'content');
    expect(twice).toBe(once);
    expect(decryptField(twice, master, 'content')).toBe(plain);
  });

  it('backwards-compatible read: plaintext passes through decryptField unchanged', () => {
    const legacy = 'old row written before encryption landed';
    expect(decryptField(legacy, master, 'content')).toBe(legacy);
  });

  it('ciphertext is bound to purpose (AAD): wrong purpose fails', () => {
    const ct = encryptField('secret', master, 'content');
    expect(() => decryptField(ct, master, 'targetRoles')).toThrow();
  });

  it('ciphertext is bound to master key: wrong key fails', () => {
    const ct = encryptField('secret', master, 'content');
    expect(() => decryptField(ct, otherMaster, 'content')).toThrow();
  });

  it('unique iv: two encrypts of the same input differ in ciphertext', () => {
    const a = encryptField('same', master, 'content');
    const b = encryptField('same', master, 'content');
    expect(a).not.toBe(b);
    expect(decryptField(a, master, 'content')).toBe('same');
    expect(decryptField(b, master, 'content')).toBe('same');
  });

  it('JSON round-trip via string encoding', () => {
    const shape = { title: 'Engineer', company: 'Acme Corp', bullets: ['built X'] };
    const ct = encryptField(JSON.stringify(shape), master, 'content');
    const back = JSON.parse(decryptField(ct, master, 'content')) as typeof shape;
    expect(back).toEqual(shape);
  });

  it('malformed marker throws instead of silently returning garbage', () => {
    expect(() => decryptField('enc:v1:no-separator', master, 'content')).toThrow();
  });
});
