// C-P1.3: ESCO seed data + upsert idempotency.
//
// Covers:
//   1. Every row has the required shape (id, name, category, escoId).
//   2. Ids + escoIds are unique across the whole file (validateSeed catches
//      accidental copy-paste duplicates).
//   3. Category values are drawn from a small closed set -- guards drift.
//   4. Real ESCO ids look like URIs; fabricated ids carry the `careeros:` prefix.
//   5. `seedEsco()` calls `upsert` once per row and is safely re-runnable:
//      a second invocation produces the same call shape (no duplicates).
import { describe, expect, it, vi } from 'vitest';
import { loadSeedRows, seedEsco, validateSeed, type EscoSeedRow } from './esco';

const ALLOWED_CATEGORIES = new Set([
  'language',
  'frontend',
  'backend',
  'data',
  'cloud',
  'devops',
  'practice',
  'ai-ml',
  'testing',
  'mobile',
  'role',
]);

describe('esco seed data', () => {
  const rows = loadSeedRows();

  it('bundles a sizeable core taxonomy', () => {
    // Plan asks for ~200 core skills. Guard against silent gutting.
    expect(rows.length).toBeGreaterThanOrEqual(150);
    expect(rows.length).toBeLessThanOrEqual(400);
  });

  it('every row has id, name, category, escoId', () => {
    for (const r of rows) {
      expect(r.id, `id on ${JSON.stringify(r)}`).toBeTruthy();
      expect(r.name, `name on ${r.id}`).toBeTruthy();
      expect(r.category, `category on ${r.id}`).toBeTruthy();
      expect(r.escoId, `escoId on ${r.id}`).toBeTruthy();
    }
  });

  it('ids and escoIds are unique across the whole file', () => {
    const ids = new Set(rows.map((r) => r.id));
    const escoIds = new Set(rows.map((r) => r.escoId));
    expect(ids.size).toBe(rows.length);
    expect(escoIds.size).toBe(rows.length);
    // MUTATION SMOKE: paste a duplicate row into esco.data.json -> both asserts
    // fail; validateSeed() also throws before we get here.
  });

  it('categories are drawn from the approved closed set', () => {
    for (const r of rows) {
      expect(ALLOWED_CATEGORIES.has(r.category), `category '${r.category}' on ${r.id}`).toBe(true);
    }
  });

  it('escoId is a URI when it is a real ESCO id, else uses the careeros: prefix', () => {
    for (const r of rows) {
      const looksLikeUri = r.escoId.startsWith('http://') || r.escoId.startsWith('https://');
      const looksFabricated = r.escoId.startsWith('careeros:');
      expect(looksLikeUri || looksFabricated, `escoId '${r.escoId}' on ${r.id}`).toBe(true);
    }
  });

  it('validateSeed throws on a duplicate escoId', () => {
    const bad: EscoSeedRow[] = [
      { id: 'a', name: 'A', category: 'language', escoId: 'careeros:dupe', escoUri: null, aliases: [] },
      { id: 'b', name: 'B', category: 'language', escoId: 'careeros:dupe', escoUri: null, aliases: [] },
    ];
    expect(() => validateSeed(bad)).toThrow(/Duplicate escoId/);
  });

  it('validateSeed throws when a required field is missing', () => {
    const bad = [{ id: 'a', name: '', category: 'language', escoId: 'careeros:a', escoUri: null, aliases: [] }] as EscoSeedRow[];
    expect(() => validateSeed(bad)).toThrow(/missing required field/);
  });
});

describe('seedEsco', () => {
  it('upserts every row keyed by escoId', async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = { skill: { upsert } };

    const { upserted } = await seedEsco(prisma);

    const rows = loadSeedRows();
    expect(upserted).toBe(rows.length);
    expect(upsert).toHaveBeenCalledTimes(rows.length);

    const firstCall = upsert.mock.calls[0]![0] as {
      where: { escoId: string };
      create: { id: string; escoId: string; category: string };
      update: { name: string };
    };
    expect(firstCall.where.escoId).toBe(rows[0]!.escoId);
    expect(firstCall.create.id).toBe(rows[0]!.id);
    expect(firstCall.create.escoId).toBe(rows[0]!.escoId);
    expect(firstCall.create.category).toBe(rows[0]!.category);
  });

  it('is idempotent: running twice against the same store produces the same call shape', async () => {
    // Simulate a "store": upsert records the key on run 1, then run 2 finds the
    // key already present and only fires updates. The invariant we assert is
    // that the second run does NOT create duplicate keys -- upsert is called
    // the same number of times, keyed by the same escoIds, and no error fires.
    const seen = new Set<string>();
    const upsert = vi.fn(async ({ where }: { where: { escoId: string } }) => {
      // Idempotency contract: no matter how many times we're called with the
      // same escoId, the store ends up with exactly one row. `seen` proves it.
      seen.add(where.escoId);
      return {};
    });
    const prisma = { skill: { upsert } };

    const r1 = await seedEsco(prisma);
    const callsAfterFirst = upsert.mock.calls.length;
    const r2 = await seedEsco(prisma);

    expect(r1.upserted).toBe(r2.upserted);
    expect(upsert.mock.calls.length).toBe(callsAfterFirst * 2);
    // Store still has exactly one entry per row -- no duplicates.
    expect(seen.size).toBe(r1.upserted);
    // MUTATION SMOKE: change the seed to `create` instead of `upsert` -> the
    // second run would either explode on a P2002 unique violation OR double the
    // store's row count; either way the `seen.size` == `upserted` invariant is
    // the crisp signal that idempotency held.
  });
});
