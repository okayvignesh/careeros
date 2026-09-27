import { QdrantClient } from '@qdrant/js-client-rest';

export interface UpsertPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown> | undefined;
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | undefined;
}

/** Qdrant payload filter. Subset of the API surface we actually need. */
export interface Match {
  key: string;
  value?: string | number | boolean;
  any?: Array<string | number | boolean>;
}
export interface PayloadFilter {
  must?: Match[];
  should?: Match[];
  mustNot?: Match[];
}

/** Payload keys indexed on every collection for filter-time speed. */
const DEFAULT_INDEXED_KEYS: Array<{ key: string; schema: 'keyword' | 'integer' }> = [
  { key: 'user_id', schema: 'keyword' },
  { key: 'sensitivity', schema: 'keyword' },
  { key: 'source_id', schema: 'keyword' },
  { key: 'source_kind', schema: 'keyword' },
];

export class QdrantStore {
  private client: QdrantClient;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  async ensureCollection(name: string, dim: number): Promise<void> {
    const existing = await this.client.getCollections();
    if (!existing.collections.some((c) => c.name === name)) {
      await this.client.createCollection(name, {
        vectors: { size: dim, distance: 'Cosine' },
        hnsw_config: { m: 16, ef_construct: 100 },
      });
    }
    // ponytail: ef_search set per-query when we need to trade recall for latency.
    // Server default (128) is fine for today's tiny corpus.
    // Payload indices are idempotent: create-on-existing is a no-op at the server.
    for (const { key, schema } of DEFAULT_INDEXED_KEYS) {
      try {
        await this.client.createPayloadIndex(name, { field_name: key, field_schema: schema });
      } catch {
        // Race: another worker may have created it in parallel. Ignore.
      }
    }
  }

  async upsert(collection: string, points: UpsertPoint[]): Promise<void> {
    const shaped = points.map((p) => {
      const base: { id: string | number; vector: number[]; payload?: Record<string, unknown> } = {
        id: p.id,
        vector: p.vector,
      };
      if (p.payload) base.payload = p.payload;
      return base;
    });
    await this.client.upsert(collection, { wait: true, points: shaped });
  }

  async search(
    collection: string,
    vector: number[],
    limit = 5,
    filter?: PayloadFilter,
  ): Promise<SearchHit[]> {
    const query: Record<string, unknown> = { query: vector, limit, with_payload: true };
    if (filter) query.filter = toQdrantFilter(filter);
    const res = await this.client.query(collection, query as never);
    return (res.points ?? []).map((p) => {
      const hit: SearchHit = { id: p.id, score: p.score };
      if (p.payload) hit.payload = p.payload as Record<string, unknown>;
      return hit;
    });
  }

  async deleteByFilter(collection: string, filter: PayloadFilter): Promise<void> {
    await this.client.delete(collection, {
      wait: true,
      filter: toQdrantFilter(filter) as never,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }
}

function toQdrantFilter(f: PayloadFilter): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  if (f.must) shape.must = f.must.map(matchToClause);
  if (f.should) shape.should = f.should.map(matchToClause);
  if (f.mustNot) shape.must_not = f.mustNot.map(matchToClause);
  return shape;
}

function matchToClause(m: Match): Record<string, unknown> {
  if (m.any !== undefined) return { key: m.key, match: { any: m.any } };
  return { key: m.key, match: { value: m.value } };
}
