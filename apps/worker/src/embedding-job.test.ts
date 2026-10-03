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
  };
  const ctrl: Ctrl = { createCalls: [], embedCalls: [], embedThrow: null };
  return { ctrl };
});

vi.mock('@careeros/embeddings', () => {
  const EMBED_DIM = 384;

  function createEmbeddingProvider(opts: Record<string, unknown>) {
    refs.ctrl.createCalls.push(opts);
    return {
      mode: 'deterministic' as const,
      model: 'test-embedder',
      dim: EMBED_DIM,
      async embed(text: string): Promise<number[]> {
        if (refs.ctrl.embedThrow) throw refs.ctrl.embedThrow;
        refs.ctrl.embedCalls.push(text);
        const vec = new Array<number>(EMBED_DIM).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % EMBED_DIM] = (vec[i % EMBED_DIM] ?? 0) + text.charCodeAt(i) / 1000;
        }
        return vec;
      },
    };
  }

  function resolveEmbeddingMode(raw: string | undefined): string {
    return raw ?? 'local';
  }

  return { createEmbeddingProvider, resolveEmbeddingMode };
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
  process.env.EMBEDDING_MODE = 'deterministic';
});

describe('handleEmbeddingGenerate provider seam', () => {
  it('embeds each chunk through createEmbeddingProvider and upserts one batch', async () => {
    const qdrant = fakeQdrant();
    const { logger } = fakeLogger();

    const result = await handleEmbeddingGenerate(
      qdrant as never,
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
      handleEmbeddingGenerate(qdrant as never, logger as unknown as Logger, payload() as never),
    ).rejects.toThrow('model exploded');
    expect(qdrant.upserts).toHaveLength(0);
  });
});
