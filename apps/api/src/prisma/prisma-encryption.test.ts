import { describe, it, expect } from 'vitest';
import { encryptField, loadMasterKey } from '@careeros/secrets';
import { decryptRow, encryptRow, type FieldSpec } from './prisma.service';

const SPECS: FieldSpec[] = [{ column: 'content', kind: 'json' }];
const KEY = loadMasterKey();

describe('field encryption round-trip (json columns)', () => {
  it('encrypts on write and decrypts back to the object', () => {
    const enc = encryptRow({ content: { a: 1, b: 'x' } }, SPECS);
    expect(typeof enc.content).toBe('string');
    expect(decryptRow(enc, SPECS).content).toEqual({ a: 1, b: 'x' });
  });

  it('does not double-encrypt an already-sealed marker', () => {
    const once = encryptRow({ content: { a: 1 } }, SPECS);
    const twice = encryptRow(once, SPECS);
    // The guard must recognise the marker before JSON.stringify wraps it in quotes.
    expect(twice.content).toBe(once.content);
    expect(decryptRow(twice, SPECS).content).toEqual({ a: 1 });
  });

  it('unwraps legacy double-encrypted rows', () => {
    // Reproduce the old bug: a manual encrypt produced a marker, which the
    // extension then stringified and encrypted again.
    const inner = encryptField(JSON.stringify({ a: 1 }), KEY, 'content');
    const legacy = encryptField(JSON.stringify(inner), KEY, 'content');
    expect(decryptRow({ content: legacy }, SPECS).content).toEqual({ a: 1 });
  });
});
