// Default the module-level provider to the offline deterministic backend so the
// real `createEmbeddingProvider()` seam is exercised without downloading weights.
process.env.EMBEDDING_MODE ??= 'deterministic';

import { describe, expect, it, vi } from 'vitest';
import { embedDeterministic, type EmbeddingProvider } from '@careeros/embeddings';
import { hashPrompt } from './hash';
import type { CorpusAdapter, CorpusItem } from './types';
import {
  CORPUS_COLLECTION,
  CORPUS_COLLECTION_DIM,
  refreshCorpus,
  type CorpusQdrant,
  type CorpusQuestionRepo,
} from './refresh.worker';

function makeItem(body: string, sourceId = 'test-src'): CorpusItem {
  return {
    sourceId,
    sourceUrl: 'https://example.com/src',
    license: 'MIT',
    title: body.slice(0, 40),
    body,
    promptHash: hashPrompt(body),
  };
}

function fakeAdapter(id: string, items: CorpusItem[]): CorpusAdapter {
  return {
    id,
    name: id,
    license: 'MIT',
    sourceUrl: 'https://example.com/' + id,
    async *fetch() {
      for (const it of items) yield it;
    },
  };
}

function fakePrisma(seedHashes: string[] = []) {
  const seen = new Set<string>(seedHashes);
  const created: Array<{ promptHash: string; embeddingId: string; sourceKind: string }> = [];
  return {
    created,
    question: {
      findUnique: async ({ where }: { where: { promptHash: string } }) => {
        return seen.has(where.promptHash) ? { id: 'x' } : null;
      },
      create: async (args: {
        data: {
          promptHash: string;
          embeddingId: string;
          sourceKind: string;
          sourceUrl: string;
          sourceAttribution: string;
          prompt: string;
        };
      }) => {
        seen.add(args.data.promptHash);
        created.push({
          promptHash: args.data.promptHash,
          embeddingId: args.data.embeddingId,
          sourceKind: args.data.sourceKind,
        });
        return { id: 'new-' + created.length };
      },
    },
  } satisfies CorpusQuestionRepo & { created: typeof created };
}

/** Qdrant stub: an in-memory vector store keyed on point id. */
function fakeQdrant(preseed: Array<{ id: string; vector: number[] }> = []) {
  const points = new Map<string, { id: string; vector: number[] }>();
  for (const p of preseed) points.set(p.id, p);
  const ensured: string[] = [];
  return {
    points,
    ensured,
    async ensureCollection(name: string, _dim: number) {
      ensured.push(name);
    },
    async upsert(_c: string, ps: Array<{ id: string; vector: number[] }>) {
      for (const p of ps) points.set(p.id, { id: p.id, vector: p.vector });
    },
    async search(_c: string, vec: number[], limit = 5) {
      // Real cosine (vectors already normalised by embedDeterministic).
      const hits = [] as Array<{ id: string | number; score: number }>;
      for (const p of points.values()) {
        let dot = 0;
        for (let i = 0; i < vec.length; i++) dot += (vec[i] ?? 0) * (p.vector[i] ?? 0);
        hits.push({ id: p.id, score: dot });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    },
  } satisfies CorpusQdrant & { points: typeof points; ensured: typeof ensured };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('refreshCorpus', () => {
  it('ensures the corpus collection on the qdrant side before ingest', async () => {
    const prisma = fakePrisma();
    const qdrant = fakeQdrant();
    await refreshCorpus(prisma, qdrant, logger, { adapters: [fakeAdapter('a', [])] });
    expect(qdrant.ensured).toContain(CORPUS_COLLECTION);
  });

  it('exposes the corpus collection dim so main.ts can bootstrap it', () => {
    expect(CORPUS_COLLECTION_DIM).toBe(384);
  });

  it('inserts brand-new items and skips hash + embedding duplicates', async () => {
    // 5 items: 2 duplicate-by-hash (pre-seed the DB), 1 duplicate-by-embedding
    // (same body as one of the new inserts, phrased identically → same vector),
    // 2 genuinely new. Expected: 2 inserted.
    const item1 = makeItem('What is a database index and how does it speed up queries?');
    const item2 = makeItem('Explain how HTTPS certificate validation works end to end.');
    const dupHash1 = makeItem('DUPHASH-A which is a pre-known question already in the DB.');
    const dupHash2 = makeItem('DUPHASH-B another pre-known question already stored.');
    const dupEmbed = makeItem('What is a database index and how does it speed up queries?'); // identical body → identical vector to item1
    // Give the embed-dup a distinct promptHash so it doesn't hit the exact
    // dedupe path (simulate a paraphrase whose embedding collapses to the
    // same vector). We inject a bogus hash for this row only.
    dupEmbed.promptHash = 'ffffffffffffffffffffffffffffffff';

    const prisma = fakePrisma([dupHash1.promptHash, dupHash2.promptHash]);
    const qdrant = fakeQdrant();
    const adapter = fakeAdapter('mixed', [item1, dupHash1, item2, dupHash2, dupEmbed]);

    const result = await refreshCorpus(prisma, qdrant, logger, { adapters: [adapter] });

    expect(result.totals).toEqual({
      fetched: 5,
      dedupedHash: 2,
      dedupedEmbed: 1,
      inserted: 2,
    });
    expect(prisma.created).toHaveLength(2);
    // Each created row got an embeddingId that maps to a Qdrant point.
    for (const row of prisma.created) {
      expect(row.embeddingId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(qdrant.points.has(row.embeddingId)).toBe(true);
    }
  });

  it('near-duplicate threshold blocks a paraphrase whose embedding lands ≥0.92', async () => {
    const original = 'Design a distributed cache with eviction, consistency, and failure recovery.';
    const preSeededVec = embedDeterministic(original);
    // Pre-populate Qdrant with the vector for `original` — simulating a
    // prior refresh that already inserted this question.
    const qdrant = fakeQdrant([{ id: 'pre-existing', vector: preSeededVec }]);
    // New item has an IDENTICAL body → embedding matches at 1.0 → blocked.
    // (Real paraphrases hit ~0.94–0.97 in the placeholder embedder.)
    const near = makeItem(original);
    // Force a different promptHash so it survives the hash-dedupe stage.
    near.promptHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const prisma = fakePrisma();
    const result = await refreshCorpus(prisma, qdrant, logger, {
      adapters: [fakeAdapter('near', [near])],
    });
    expect(result.totals.dedupedEmbed).toBe(1);
    expect(result.totals.inserted).toBe(0);
    expect(prisma.created).toHaveLength(0);
  });

  it('records per-adapter summaries + totals; one adapter failing does not sink the rest', async () => {
    const good = fakeAdapter('good', [makeItem('Q: how do you version a REST API safely?')]);
    const bad: CorpusAdapter = {
      id: 'bad',
      name: 'bad',
      license: 'MIT',
      sourceUrl: 'https://example.com/bad',
      async *fetch() {
        throw new Error('network flake');
      },
    };
    const prisma = fakePrisma();
    const qdrant = fakeQdrant();
    const result = await refreshCorpus(prisma, qdrant, logger, { adapters: [bad, good] });
    expect(result.perAdapter.map((s) => s.adapter)).toEqual(['bad', 'good']);
    const goodSummary = result.perAdapter.find((s) => s.adapter === 'good')!;
    expect(goodSummary.inserted).toBe(1);
    expect(result.totals.inserted).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('routes dedupe vectors through the injected EmbeddingProvider seam', async () => {
    const item = makeItem('What is idempotency and why does it matter for workers?');
    const calls: string[] = [];
    const provider: EmbeddingProvider = {
      mode: 'deterministic',
      model: 'spy',
      dim: 384,
      async embed(text: string) {
        calls.push(text);
        return embedDeterministic(text);
      },
    };
    const prisma = fakePrisma();
    const qdrant = fakeQdrant();

    const result = await refreshCorpus(prisma, qdrant, logger, {
      adapters: [fakeAdapter('seam', [item])],
      provider,
    });

    expect(calls).toEqual([item.body]);
    expect(result.totals.inserted).toBe(1);
    // The provider's vector is what landed in Qdrant.
    const stored = [...qdrant.points.values()][0]!;
    expect(stored.vector).toEqual(embedDeterministic(item.body));
  });
});

// MUTATION SMOKE:
//  - Swap `>= threshold` → `> threshold` in refresh.worker → near-duplicate
//    test drops from 1 embed-dup to 1 insert.
//  - Drop the `await ensureCollection` call → first test's `ensured` array is empty.
//  - Skip the hash pre-check → dedupedHash counts move to inserted; totals shift.
