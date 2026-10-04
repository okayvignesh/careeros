// QdrantStore.ensureCollection behaviour: creating, no-op when present, and the
// destructive dimension-mismatch recreate that keeps external embeddings usable.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
  collections: [] as Array<{ name: string }>,
  sizes: new Map<string, number>(),
  createCalls: [] as Array<{ name: string; size: number }>,
  deleteCalls: [] as string[],
}));

vi.mock('@qdrant/js-client-rest', () => {
  class QdrantClient {
    async getCollections() {
      return { collections: refs.collections };
    }
    async getCollection(name: string) {
      return { config: { params: { vectors: { size: refs.sizes.get(name) ?? 0 } } } };
    }
    async createCollection(name: string, body: { vectors: { size: number } }) {
      refs.createCalls.push({ name, size: body.vectors.size });
      refs.collections.push({ name });
      refs.sizes.set(name, body.vectors.size);
    }
    async deleteCollection(name: string) {
      refs.deleteCalls.push(name);
      refs.collections = refs.collections.filter((c) => c.name !== name);
    }
    async createPayloadIndex() {}
    async upsert() {}
    async query() {
      return { points: [] };
    }
    async delete() {}
  }
  return { QdrantClient };
});

import { QdrantStore } from './qdrant';

beforeEach(() => {
  refs.collections = [];
  refs.sizes = new Map();
  refs.createCalls = [];
  refs.deleteCalls = [];
});

describe('QdrantStore.ensureCollection', () => {
  it('creates the collection at the requested dimension when absent', async () => {
    const store = new QdrantStore('http://qdrant:6333');
    const outcome = await store.ensureCollection('career_facts', 1536);
    expect(outcome).toBe('created');
    expect(refs.createCalls).toEqual([{ name: 'career_facts', size: 1536 }]);
  });

  it('leaves an existing same-dimension collection untouched', async () => {
    refs.collections = [{ name: 'career_facts' }];
    refs.sizes.set('career_facts', 384);
    const store = new QdrantStore('http://qdrant:6333');
    const outcome = await store.ensureCollection('career_facts', 384);
    expect(outcome).toBe('exists');
    expect(refs.deleteCalls).toHaveLength(0);
    expect(refs.createCalls).toHaveLength(0);
  });

  it('recreates + warns when the existing dimension differs', async () => {
    refs.collections = [{ name: 'career_facts' }];
    refs.sizes.set('career_facts', 384);
    const warns: string[] = [];
    const store = new QdrantStore('http://qdrant:6333');
    const outcome = await store.ensureCollection('career_facts', 1536, {
      recreateOnMismatch: true,
      logger: { warn: (_o, msg) => warns.push(msg) },
    });
    expect(outcome).toBe('recreated');
    expect(refs.deleteCalls).toEqual(['career_facts']);
    expect(refs.createCalls).toEqual([{ name: 'career_facts', size: 1536 }]);
    expect(warns[0]).toMatch(/dimension changed/i);
  });

  it('does NOT recreate a mismatched collection unless opted in', async () => {
    refs.collections = [{ name: 'career_facts' }];
    refs.sizes.set('career_facts', 384);
    const store = new QdrantStore('http://qdrant:6333');
    const outcome = await store.ensureCollection('career_facts', 1536);
    expect(outcome).toBe('exists');
    expect(refs.deleteCalls).toHaveLength(0);
  });
});
