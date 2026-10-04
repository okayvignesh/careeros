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

/** What `ensureCollection` did, so callers can warn on a destructive recreate. */
export type EnsureCollectionOutcome = 'created' | 'exists' | 'recreated';

/** Logger surface used for destructive-recreate warnings. */
export interface EnsureCollectionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface EnsureCollectionOptions {
  /**
   * When the collection exists at a different vector size, drop + recreate it
   * at the requested size. This discards every stored vector, so the caller
   * must log a re-embed notice (return value `recreated`).
   */
  recreateOnMismatch?: boolean;
  logger?: EnsureCollectionLogger;
}

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

  async ensureCollection(
    name: string,
    dim: number,
    opts: EnsureCollectionOptions = {},
  ): Promise<EnsureCollectionOutcome> {
    const existing = await this.client.getCollections();
    const present = existing.collections.some((c) => c.name === name);

    if (present) {
      if (opts.recreateOnMismatch) {
        const size = await this.collectionVectorSize(name);
        if (size !== undefined && size !== dim) {
          opts.logger?.warn(
            { collection: name, existingDim: size, requestedDim: dim },
            'qdrant collection vector dimension changed; dropping and recreating — stored vectors will be re-embedded',
          );
          await this.client.deleteCollection(name);
          await this.create(name, dim);
          return 'recreated';
        }
      }
      await this.createPayloadIndices(name);
      return 'exists';
    }

    await this.create(name, dim);
    return 'created';
  }

  private async create(name: string, dim: number): Promise<void> {
    await this.client.createCollection(name, {
      vectors: { size: dim, distance: 'Cosine' },
      hnsw_config: { m: 16, ef_construct: 100 },
    });
    await this.createPayloadIndices(name);
  }

  /** Vector size of a single (unnamed) vector config, or the first named one. */
  private async collectionVectorSize(name: string): Promise<number | undefined> {
    try {
      const info = await this.client.getCollection(name);
      const vectors = info.config?.params?.vectors as
        | { size?: unknown }
        | Record<string, { size?: unknown }>
        | undefined;
      if (!vectors) return undefined;
      const direct = (vectors as { size?: unknown }).size;
      if (typeof direct === 'number') return direct;
      for (const value of Object.values(vectors as Record<string, { size?: unknown }>)) {
        if (value && typeof value.size === 'number') return value.size;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async createPayloadIndices(name: string): Promise<void> {
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
