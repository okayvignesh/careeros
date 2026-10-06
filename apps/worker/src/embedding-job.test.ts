// embedding.generate handler tests. The provider seam is mocked so we can prove
// the handler embeds through `createEmbeddingProvider()` (not the old direct
// `embedDeterministic`), keeps one batched Qdrant upsert, and passes a logger so
// the package's deterministic fallback can warn. QdrantStore is only a type
// import in the handler, so a plain stub is enough.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => {
  type Ctrl = {
    createCalls: Array<Record<string, unknown>>;
    embedCalls: string[];
    embedThrow: Error | null;
    resolved: Record<string, unknown> | null;
    /** Force the mock provider's vector length (dimension-mismatch tests). */
    vectorLength: number | null;
  };
  const ctrl: Ctrl = {
    createCalls: [],
    embedCalls: [],
    embedThrow: null,
    resolved: null,
    vectorLength: null,
  };
  return { ctrl };
});

vi.mock('@careeros/embeddings', () => {
  const EMBED_DIM = 384;

  function loadResolvedEmbeddingConfig() {
    if (refs.ctrl.resolved) return refs.ctrl.resolved;
    const mode = process.env.EMBEDDING_MODE ?? 'local';
    return {
      mode,
      model: 'test-embedder',
      dim: EMBED_DIM,
      hasApiKey: false,
      external: undefined,
      source: 'env',
    };
  }

  function createProviderFromResolved(
    resolved: { mode: string; dim?: number },
    opts: Record<string, unknown> = {},
  ) {
    refs.ctrl.createCalls.push({ ...resolved, ...opts });
    const dim = resolved.dim ?? EMBED_DIM;
    const emitted = refs.ctrl.vectorLength ?? dim;
    return {
      mode: resolved.mode,
      model: 'test-embedder',
      dim,
      async embed(text: string): Promise<number[]> {
        if (refs.ctrl.embedThrow) throw refs.ctrl.embedThrow;
        refs.ctrl.embedCalls.push(text);
        const vec = new Array<number>(emitted).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % emitted] = (vec[i % emitted] ?? 0) + text.charCodeAt(i) / 1000;
        }
        return vec;
      },
    };
  }

  return {
    loadResolvedEmbeddingConfig,
    createProviderFromResolved,
    EMBEDDING_API_KEY_PURPOSE: 'embedding.externalApiKey',
  };
});

import type { Logger } from 'pino';
import { handleEmbeddingGenerate } from './embedding-job';

type Point = { id: string; vector: number[]; payload?: Record<string, unknown> };

function fakeQdrant() {
  const upserts: Array<{ collection: string; points: Point[] }> = [];
  return {
    upserts,
    async ping() {
      return true;
    },
    async ensureCollection() {},
    async upsert(collection: string, points: Point[]) {
      upserts.push({ collection, points });
    },
    async search() {
      return [];
    },
    async deleteByFilter() {},
    async deleteCollection() {},
  };
}

function fakeLogger() {
  const child = { info: vi.fn(), warn: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), child: vi.fn(() => child) };
  return { logger, child };
}

function fakeConfigRepo() {
  return { appConfig: { findUnique: async () => null } };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    collection: 'career_facts',
    sourceId: 's1',
    sourceKind: 'resume_fact',
    text: 'hello world',
    sensitivity: 'personal' as const,
    meta: { kind: 'headline' },
    ...overrides,
  };
}

beforeEach(() => {
  refs.ctrl.embedCalls = [];
  refs.ctrl.embedThrow = null;
  refs.ctrl.resolved = null;
  refs.ctrl.vectorLength = null;
  process.env.EMBEDDING_MODE = 'deterministic';
});

describe('handleEmbeddingGenerate provider seam', () => {
  it('embeds each chunk through createEmbeddingProvider and upserts one batch', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();

    const result = await handleEmbeddingGenerate(
      qdrant as never,
      fakeConfigRepo() as never,
      logger as unknown as Logger,
      payload() as never,
    );

    expect(refs.ctrl.createCalls.length).toBeGreaterThan(0);
    // A warn-capable logger is threaded into the provider so the package's
    // deterministic fallback can surface a warning.
    const first = refs.ctrl.createCalls[0] as { mode?: string; logger?: { warn?: unknown } };
    expect(first.mode).toBe('deterministic'); // resolved from EMBEDDING_MODE
    expect(typeof first.logger?.warn).toBe('function');
    expect(refs.ctrl.embedCalls).toEqual(['hello world']);
    expect(result).toEqual({ chunks: 1, skipped: 0 });
    expect(qdrant.upserts).toHaveLength(1);
    const batch = qdrant.upserts[0]!;
    expect(batch.collection).toBe('career_facts');
    expect(batch.points).toHaveLength(1);
    expect(batch.points[0]!.vector).toHaveLength(384);
    expect(batch.points[0]!.payload).toMatchObject({
      user_id: 'u1',
      source_id: 's1',
      source_kind: 'resume_fact',
      chunk_idx: 0,
      kind: 'headline',
    });
  });

  it('routes every chunk of a long input through the provider (one embed call per chunk)', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();
    const text = 'a'.repeat(2100); // 2048 window + 256 overlap → 2 chunks

    const result = await handleEmbeddingGenerate(
      qdrant as never,
      fakeConfigRepo() as never,
      logger as unknown as Logger,
      payload({ text }) as never,
    );

    expect(result.chunks).toBe(2);
    expect(refs.ctrl.embedCalls).toHaveLength(2);
    expect(qdrant.upserts).toHaveLength(1);
    expect(qdrant.upserts[0]!.points).toHaveLength(2);
  });

  it('drops unknown collections before touching the provider', async () => {
    const qdrant = fakeQdrant();
    const { logger, child } = fakeLogger();
    const before = refs.ctrl.embedCalls.length;

    const result = await handleEmbeddingGenerate(
      qdrant as never,
      fakeConfigRepo() as never,
      logger as unknown as Logger,
      payload({ collection: 'nope' }) as never,
    );

    expect(result).toEqual({ chunks: 0, skipped: 0 });
    expect(refs.ctrl.embedCalls).toHaveLength(before);
    expect(child.warn).toHaveBeenCalled();
  });

  it('propagates a provider failure instead of silently writing bad vectors', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();
    refs.ctrl.embedThrow = new Error('model exploded');

    await expect(
      handleEmbeddingGenerate(
        qdrant as never,
        fakeConfigRepo() as never,
        logger as unknown as Logger,
        payload() as never,
      ),
    ).rejects.toThrow('model exploded');
    expect(qdrant.upserts).toHaveLength(0);
  });

  it('uses the DB-resolved external dimension (1536) for the upserted vectors', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();
    refs.ctrl.resolved = {
      mode: 'external',
      model: 'text-embedding-3-small',
      dim: 1536,
      hasApiKey: true,
      external: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk', model: 'm', dimensions: 1536 },
      source: 'app_config',
    };

    const result = await handleEmbeddingGenerate(
      qdrant as never,
      fakeConfigRepo() as never,
      logger as unknown as Logger,
      payload() as never,
    );

    expect(result).toEqual({ chunks: 1, skipped: 0 });
    expect(qdrant.upserts[0]!.points[0]!.vector).toHaveLength(1536);
  });

  it('throws when the provider vector does not match the resolved collection dimension', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();
    refs.ctrl.resolved = {
      mode: 'external',
      model: 'm',
      dim: 1536,
      hasApiKey: true,
      external: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk', model: 'm', dimensions: 1536 },
      source: 'app_config',
    };
    // Simulate a provider that returns the wrong width for the declared dim.
    refs.ctrl.vectorLength = 384;

    await expect(
      handleEmbeddingGenerate(
        qdrant as never,
        fakeConfigRepo() as never,
        logger as unknown as Logger,
        payload() as never,
      ),
    ).rejects.toThrow(/dimension mismatch/i);
    expect(qdrant.upserts).toHaveLength(0);
  });
});
