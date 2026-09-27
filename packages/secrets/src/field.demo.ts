// Assert-based self-check for the field-level encryption helpers.
// Run: npx tsx packages/secrets/src/field.demo.ts (from a workspace with tsx).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptField, encryptField, isEncryptedField } from './field';

const master = randomBytes(32);
const otherMaster = randomBytes(32);

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

label('round-trip: encryptField → decryptField returns the original', () => {
  const plain = 'This is a resume bullet with a company name.';
  const ct = encryptField(plain, master, 'content');
  assert(isEncryptedField(ct));
  assert(ct.startsWith('enc:v1:content:'));
  assert.equal(decryptField(ct, master, 'content'), plain);
});

label('idempotent: encrypting an already-encrypted value returns it verbatim', () => {
  const plain = 'hello';
  const once = encryptField(plain, master, 'content');
  const twice = encryptField(once, master, 'content');
  assert.equal(once, twice);
  assert.equal(decryptField(twice, master, 'content'), plain);
});

label('backwards-compatible read: plaintext passes through decryptField unchanged', () => {
  const legacy = 'old row written before encryption landed';
  assert.equal(decryptField(legacy, master, 'content'), legacy);
});

label('ciphertext is bound to purpose (AAD): wrong purpose fails', () => {
  const ct = encryptField('secret', master, 'content');
  assert.throws(() => decryptField(ct, master, 'targetRoles'));
});

label('ciphertext is bound to master key: wrong key fails', () => {
  const ct = encryptField('secret', master, 'content');
  assert.throws(() => decryptField(ct, otherMaster, 'content'));
});

label('unique iv: two encrypts of the same input differ in ciphertext', () => {
  const a = encryptField('same', master, 'content');
  const b = encryptField('same', master, 'content');
  assert.notEqual(a, b);
  assert.equal(decryptField(a, master, 'content'), 'same');
  assert.equal(decryptField(b, master, 'content'), 'same');
});

label('JSON round-trip via string encoding', () => {
  const shape = { title: 'Engineer', company: 'Acme Corp', bullets: ['built X'] };
  const ct = encryptField(JSON.stringify(shape), master, 'content');
  const back = JSON.parse(decryptField(ct, master, 'content')) as typeof shape;
  assert.deepEqual(back, shape);
});

label('malformed marker throws instead of silently returning garbage', () => {
  assert.throws(() => decryptField('enc:v1:no-separator', master, 'content'));
});

// eslint-disable-next-line no-console
console.log('\nall field-encryption checks passed');
