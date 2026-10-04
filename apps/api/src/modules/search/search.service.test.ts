// SearchService tests. `@careeros/embeddings` is mocked so QdrantStore is an
// in-memory stub and `createEmbeddingProvider` hands back a controllable embedder
// — proving the service embeds the query through the provider seam and feeds the
// exact provider vector to Qdrant, while keeping the filter/dedupe/limit shape.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => {
  type Hit = { id: string | number; score: number; payload?: Record<string, unknown> };
  type Ctrl = {
    lastCtorUrl: string | null;
    createCalls: Array<Record<string, unknown>>;
    embedCalls: string[];
    searchCalls: Array<{ collection: string; vector: number[]; limit: number; filter?: unknown }>;
    searchHits: Hit[];
  };
  const ctrl: Ctrl = {
    lastCtorUrl: null,
    createCalls: [],
    embedCalls: [],
    searchCalls: [],
    searchHits: [],
  };
  return { ctrl };
});

vi.mock('@careeros/embeddings', () => {
  const EMBED_DIM = 384;

  function loadResolvedEmbeddingConfig() {
    return {
      mode: (process.env.EMBEDDING_MODE ?? 'local') as string,
      model: 'test-embedder',
      dim: EMBED_DIM,
      hasApiKey: false,
      external: undefined,
      source: 'env',
    };
  }

  function createProviderFromResolved(
    resolved: { mode: string; dim: number },
    opts: Record<string, unknown> = {},
  ) {
    refs.ctrl.createCalls.push({ ...resolved, ...opts });
    return {
      mode: resolved.mode,
      model: 'test-embedder',
      dim: resolved.dim,
      async embed(text: string): Promise<number[]> {
        refs.ctrl.embedCalls.push(text);
        const vec = new Array<number>(resolved.dim).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % resolved.dim] = (vec[i % resolved.dim] ?? 0) + text.charCodeAt(i) / 1000;
        }
        return vec;
      },
    };
  }

  class QdrantStore {
    constructor(url: string) {
      refs.ctrl.lastCtorUrl = url;
    }
    async ping() {
      return true;
    }
    async ensureCollection() {}
    async upsert() {}
    async search(collection: string, vector: number[], limit = 5, filter?: unknown) {
      refs.ctrl.searchCalls.push({ collection, vector, limit, filter });
      return refs.ctrl.searchHits;
    }
    async deleteByFilter() {}
    async deleteCollection() {}
  }

  return {
    QdrantStore,
    loadResolvedEmbeddingConfig,
    createProviderFromResolved,
    EMBEDDING_API_KEY_PURPOSE: 'embedding.externalApiKey',
    EMBED_DIM,
  };
});

import { SearchService } from './search.service';

function expectedVector(text: string): number[] {
  const vec = new Array<number>(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] = (vec[i % 384] ?? 0) + text.charCodeAt(i) / 1000;
  }
  return vec;
}

function makePrisma() {
  return { resumeFact: { findMany: vi.fn(async () => []) } };
}

function makeService() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return new SearchService(makePrisma() as never, logger as never);
}

beforeEach(() => {
  refs.ctrl.lastCtorUrl = null;
  refs.ctrl.createCalls = [];
  refs.ctrl.embedCalls = [];
  refs.ctrl.searchCalls = [];
  refs.ctrl.searchHits = [];
  process.env.EMBEDDING_MODE = 'deterministic';
});

describe('SearchService provider seam', () => {
  it('embeds the trimmed query through createEmbeddingProvider and searches that vector', async () => {
    const svc = makeService();
    await svc.search('u1', '  semantic query  ', { collection: 'code_chunks' });

    expect(refs.ctrl.createCalls).toHaveLength(1);
    const first = refs.ctrl.createCalls[0] as { mode?: string; logger?: { warn?: unknown } };
    expect(first.mode).toBe('deterministic'); // resolved from EMBEDDING_MODE
    expect(typeof first.logger?.warn).toBe('function');

    expect(refs.ctrl.embedCalls).toEqual(['semantic query']);
    expect(refs.ctrl.searchCalls).toHaveLength(1);
    const call = refs.ctrl.searchCalls[0]!;
    expect(call.collection).toBe('code_chunks');
    expect(call.vector).toEqual(expectedVector('semantic query'));
    expect(call.limit).toBe(30); // default limit 10, over-fetch ×3
  });

  it('passes a user + sensitivity ceiling filter to Qdrant', async () => {
    const svc = makeService();
    await svc.search('u1', 'query', { collection: 'code_chunks' });

    const filter = refs.ctrl.searchCalls[0]!.filter as {
      must: Array<{ key: string; value?: unknown; any?: unknown[] }>;
    };
    expect(filter.must).toContainEqual({ key: 'user_id', value: 'u1' });
    expect(filter.must).toContainEqual({ key: 'sensitivity', any: ['public', 'personal'] });
  });

  it('dedupes hits by source_id keeping the best score, then caps to limit', async () => {
    refs.ctrl.searchHits = [
      { id: 'a1', score: 0.5, payload: { source_id: 'a', chunk_idx: 0 } },
      { id: 'a2', score: 0.9, payload: { source_id: 'a', chunk_idx: 1 } },
      { id: 'b1', score: 0.8, payload: { source_id: 'b', chunk_idx: 0 } },
    ];
    const svc = makeService();
    const hits = await svc.search('u1', 'query', { collection: 'code_chunks' });

    expect(hits.map((h) => h.sourceId)).toEqual(['a', 'b']);
    expect(hits.map((h) => h.score)).toEqual([0.9, 0.8]);
  });

  it('returns [] for a blank query without embedding', async () => {
    const svc = makeService();
    expect(await svc.search('u1', '   ')).toEqual([]);
    expect(refs.ctrl.embedCalls).toHaveLength(0);
    expect(refs.ctrl.searchCalls).toHaveLength(0);
  });

  it('rejects an over-long query before embedding', async () => {
    const svc = makeService();
    await expect(svc.search('u1', 'x'.repeat(2001))).rejects.toThrow(/too long/i);
    expect(refs.ctrl.embedCalls).toHaveLength(0);
  });

  it('rejects an unknown collection before embedding', async () => {
    const svc = makeService();
    await expect(svc.search('u1', 'query', { collection: 'not_a_collection' })).rejects.toThrow(
      /unknown collection/i,
    );
    expect(refs.ctrl.embedCalls).toHaveLength(0);
  });
});
