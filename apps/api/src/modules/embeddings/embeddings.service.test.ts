// B-8: encode -> upsert -> search round-trip for EmbeddingsService.
// The service builds a QdrantStore at field-init and calls embedDeterministic
// inside .test(). We mock @careeros/embeddings so QdrantStore is an in-memory
// fake and embedDeterministic is a spy-wrapped stub embedder. No live Qdrant.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Shared refs the mock factory writes to. hoisted() so vi.mock can see them. ---
const refs = vi.hoisted(() => {
  type Point = { id: string | number; vector: number[]; payload?: Record<string, unknown> };
  type Hit = { id: string | number; score: number; payload?: Record<string, unknown> };
  type Ctrl = {
    // per-test toggles
    pingResult: boolean;
    ensureThrow: Error | null;
    upsertThrow: Error | null;
    searchOverride: Hit[] | null;
    embedThrow: Error | null;
    // per-test observability
    lastCtorUrl: string | null;
    ensureCalls: Array<{ name: string; dim: number }>;
    upsertCalls: Array<{ collection: string; points: Point[] }>;
    searchCalls: Array<{ collection: string; vector: number[]; limit?: number }>;
    embedCalls: string[];
    // shared storage across the fake
    storage: Map<string, Point[]>;
  };
  const ctrl: Ctrl = {
    pingResult: true,
    ensureThrow: null,
    upsertThrow: null,
    searchOverride: null,
    embedThrow: null,
    lastCtorUrl: null,
    ensureCalls: [],
    upsertCalls: [],
    searchCalls: [],
    embedCalls: [],
    storage: new Map(),
  };
  return { ctrl };
});

vi.mock('@careeros/embeddings', () => {
  const EMBED_DIM = 384;

  // Stub embedder: deterministic per input, dimension EMBED_DIM. Not the real
  // hash-based unit vector, just something round-trippable and unique per text.
  function embedDeterministic(text: string): number[] {
    if (refs.ctrl.embedThrow) throw refs.ctrl.embedThrow;
    refs.ctrl.embedCalls.push(text);
    const vec = new Array<number>(EMBED_DIM);
    // Simple char-sum seed. Different text -> different vector -> different key.
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) | 0;
    for (let i = 0; i < EMBED_DIM; i++) vec[i] = ((seed + i) % 200) / 200;
    return vec;
  }

  class QdrantStore {
    constructor(url: string) {
      refs.ctrl.lastCtorUrl = url;
    }
    async ping(): Promise<boolean> {
      return refs.ctrl.pingResult;
    }
    async ensureCollection(name: string, dim: number): Promise<void> {
      refs.ctrl.ensureCalls.push({ name, dim });
      if (refs.ctrl.ensureThrow) throw refs.ctrl.ensureThrow;
      if (!refs.ctrl.storage.has(name)) refs.ctrl.storage.set(name, []);
    }
    async upsert(
      collection: string,
      points: Array<{ id: string | number; vector: number[]; payload?: Record<string, unknown> }>,
    ): Promise<void> {
      refs.ctrl.upsertCalls.push({ collection, points });
      if (refs.ctrl.upsertThrow) throw refs.ctrl.upsertThrow;
      const bucket = refs.ctrl.storage.get(collection) ?? [];
      for (const p of points) bucket.push(p);
      refs.ctrl.storage.set(collection, bucket);
    }
    async search(
      collection: string,
      vector: number[],
      limit = 5,
    ): Promise<Array<{ id: string | number; score: number; payload?: Record<string, unknown> }>> {
      refs.ctrl.searchCalls.push({ collection, vector, limit });
      if (refs.ctrl.searchOverride !== null) return refs.ctrl.searchOverride;
      const bucket = refs.ctrl.storage.get(collection) ?? [];
      // Round-trip: match by exact vector equality on the first component and length.
      const hits = bucket
        .filter((p) => p.vector.length === vector.length && p.vector[0] === vector[0])
        .map((p) => {
          const hit: { id: string | number; score: number; payload?: Record<string, unknown> } = {
            id: p.id,
            score: 1.0,
          };
          if (p.payload) hit.payload = p.payload;
          return hit;
        });
      return hits.slice(0, limit);
    }
  }

  // Provider seam: the service resolves an EmbeddingProvider and calls .embed().
  // The fake reports deterministic (the CI-safe backend) and delegates to the
  // spy-wrapped embedDeterministic so the existing call-tracking still works.
  function createEmbeddingProvider(): {
    mode: 'deterministic';
    model: string;
    dim: number;
    embed: (text: string) => Promise<number[]>;
  } {
    return {
      mode: 'deterministic',
      model: 'test-deterministic',
      dim: EMBED_DIM,
      async embed(text: string): Promise<number[]> {
        return embedDeterministic(text);
      },
    };
  }

  function resolveEmbeddingMode(): 'deterministic' {
    return 'deterministic';
  }

  function validateExternalEmbeddingConfig(cfg: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }): void {
    if (!cfg.baseUrl) throw new Error('external embeddings: baseUrl is required');
    if (!cfg.apiKey) throw new Error('external embeddings: apiKey is required');
    if (!cfg.model) throw new Error('external embeddings: model is required');
  }

  return {
    QdrantStore,
    embedDeterministic,
    EMBED_DIM,
    createEmbeddingProvider,
    resolveEmbeddingMode,
    validateExternalEmbeddingConfig,
    EMBEDDING_API_KEY_PURPOSE: 'embedding.externalApiKey',
  };
});

// Import AFTER vi.mock so the field initializer picks up the fake QdrantStore.
import { EmbeddingsService, type EmbeddingConfig } from './embeddings.service';

// Minimal Prisma double: only appConfig.upsert/findUnique are used.
function makePrisma(saved: EmbeddingConfig | null = null) {
  return {
    appConfig: {
      upsert: vi.fn(async (_args: unknown) => ({})),
      findUnique: vi.fn(
        async (_args: unknown) => (saved ? { value: saved } : null) as { value: unknown } | null,
      ),
    },
  };
}

beforeEach(() => {
  refs.ctrl.pingResult = true;
  refs.ctrl.ensureThrow = null;
  refs.ctrl.upsertThrow = null;
  refs.ctrl.searchOverride = null;
  refs.ctrl.embedThrow = null;
  refs.ctrl.ensureCalls = [];
  refs.ctrl.upsertCalls = [];
  refs.ctrl.searchCalls = [];
  refs.ctrl.embedCalls = [];
  refs.ctrl.storage = new Map();
});

describe('EmbeddingsService constructor (B-8)', () => {
  it('wires QdrantStore to the QDRANT_URL env value', () => {
    const prisma = makePrisma();
    new EmbeddingsService(prisma as never);
    // vitest.setup.ts sets QDRANT_URL=http://localhost:6333.
    expect(refs.ctrl.lastCtorUrl).toBe(process.env.QDRANT_URL);
    // mutation smoke: if the ctor forgot to pass QDRANT_URL, lastCtorUrl would be undefined.
    expect(refs.ctrl.lastCtorUrl).not.toBeNull();
  });
});

describe('EmbeddingsService.test encode step (B-8)', () => {
  it('calls the embedder with the exact sample text (single-input shape)', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await svc.test('hello embeddings');
    expect(refs.ctrl.embedCalls).toEqual(['hello embeddings']);
    // mutation smoke: if the service embedded the wrong string (e.g. collection name),
    // the array would not equal ['hello embeddings'].
  });

  it('defaults the sample text when none is provided', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await svc.test();
    expect(refs.ctrl.embedCalls).toHaveLength(1);
    expect(refs.ctrl.embedCalls[0]).toMatch(/round-trip/i);
    // mutation smoke: removing the default arg would leave embedCalls[0] === undefined.
  });
});

describe('EmbeddingsService.test upsert step (B-8)', () => {
  it('upserts a single point with {id, vector, payload:{text}} into the test collection', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    const sample = 'upsert-shape-check';
    await svc.test(sample);
    expect(refs.ctrl.upsertCalls).toHaveLength(1);
    const call = refs.ctrl.upsertCalls[0]!;
    expect(call.collection).toBe('_setup_test');
    expect(call.points).toHaveLength(1);
    const point = call.points[0]!;
    expect(typeof point.id).toBe('number');
    expect(Array.isArray(point.vector)).toBe(true);
    expect(point.vector.length).toBe(384);
    expect(point.payload).toEqual({ text: sample });
    // mutation smoke: swapping payload.text for payload.body would fail toEqual.
  });

  it('ensures the collection with EMBED_DIM before upserting', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await svc.test('ensure-before-upsert');
    expect(refs.ctrl.ensureCalls).toEqual([{ name: '_setup_test', dim: 384 }]);
    // mutation smoke: passing a wrong dim (e.g. 512) or wrong collection name breaks toEqual.
  });
});

describe('EmbeddingsService.test search step (B-8)', () => {
  it('searches the test collection with the encoded vector and limit=1', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await svc.test('search-shape-check');
    expect(refs.ctrl.searchCalls).toHaveLength(1);
    const call = refs.ctrl.searchCalls[0]!;
    expect(call.collection).toBe('_setup_test');
    expect(call.limit).toBe(1);
    expect(call.vector.length).toBe(384);
    // The vector fed to search must equal the one produced by the embedder.
    expect(call.vector).toEqual(refs.ctrl.upsertCalls[0]!.points[0]!.vector);
    // mutation smoke: if the service re-embedded a different string for search,
    // the two vectors would diverge and toEqual would fail.
  });
});

describe('EmbeddingsService.test round-trip (B-8)', () => {
  it('returns qdrantReachable + upsertOk + searchOk with topScore>0.99 when the fake stores + returns the same doc', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('round-trip-doc');
    expect(res.qdrantReachable).toBe(true);
    expect(res.upsertOk).toBe(true);
    expect(res.searchOk).toBe(true);
    expect(res.topScore).toBeGreaterThan(0.99);
    expect(res.error).toBeUndefined();
    // mutation smoke: if searchOk lost the `top.id === id` check, an empty
    // storage would still report searchOk:true. The pairing with topScore>0.99
    // + upsertOk true only holds when the round-trip actually completes.
  });

  it('reports searchOk:false when the fake returns a different id (round-trip mismatch)', async () => {
    // Force search to return a hit whose id differs from the just-upserted point.
    refs.ctrl.searchOverride = [{ id: 'not-the-upserted-id', score: 1.0 }];
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('mismatch-id');
    expect(res.upsertOk).toBe(true);
    expect(res.searchOk).toBe(false);
    // mutation smoke: dropping the id-equality check in the service would flip
    // searchOk to true here.
  });

  it('reports searchOk:false when the top score is below the 0.99 confidence gate', async () => {
    refs.ctrl.searchOverride = [{ id: Date.now(), score: 0.5 }];
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('low-score');
    expect(res.searchOk).toBe(false);
    expect(res.topScore).toBe(0.5);
    // mutation smoke: loosening the gate to `>= 0` would make this pass falsely.
  });
});

describe('EmbeddingsService.test effective provider reporting', () => {
  it('reports the active provider mode/model/dim (not a hardcoded bge claim)', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('report-provider');
    expect(res.mode).toBe('deterministic');
    expect(res.model).toBe('test-deterministic');
    expect(res.dim).toBe(384);
    // mutation smoke: if the service hardcoded mode:'local'/model:'bge-small-en'
    // in TestResult, these would not match the provider actually used.
  });
});

describe('EmbeddingsService.test failure paths (B-8)', () => {
  it('surfaces qdrantReachable:false when ping fails (does not throw)', async () => {
    refs.ctrl.pingResult = false;
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('ping-down');
    expect(res.qdrantReachable).toBe(false);
    expect(res.upsertOk).toBe(false);
    expect(res.searchOk).toBe(false);
    expect(res.error).toBe('Qdrant unreachable');
    // Did NOT reach embed / ensure / upsert / search.
    expect(refs.ctrl.embedCalls).toHaveLength(0);
    expect(refs.ctrl.ensureCalls).toHaveLength(0);
    expect(refs.ctrl.upsertCalls).toHaveLength(0);
    expect(refs.ctrl.searchCalls).toHaveLength(0);
    // mutation smoke: removing the early-return on !reachable would trigger the
    // downstream calls and these length assertions would fail.
  });

  it('captures the embedder error into TestResult.error rather than throwing', async () => {
    refs.ctrl.embedThrow = new Error('embedder-boom');
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('embedder-fails');
    expect(res.qdrantReachable).toBe(true);
    expect(res.upsertOk).toBe(false);
    expect(res.searchOk).toBe(false);
    expect(res.error).toBe('embedder-boom');
    // mutation smoke: removing the try/catch would let the error propagate and
    // svc.test(...) would reject, failing `res.error === 'embedder-boom'`.
  });

  it('captures a qdrant upsert error into TestResult.error rather than throwing', async () => {
    refs.ctrl.upsertThrow = new Error('upsert-broke');
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('upsert-fails');
    expect(res.upsertOk).toBe(false);
    expect(res.error).toBe('upsert-broke');
    // mutation smoke: same as above; the try/catch is what keeps this from throwing.
  });

  it('returns searchOk:false + topScore 0 (not throws) when qdrant search returns empty', async () => {
    refs.ctrl.searchOverride = [];
    const svc = new EmbeddingsService(makePrisma() as never);
    const res = await svc.test('empty-hits');
    expect(res.qdrantReachable).toBe(true);
    expect(res.upsertOk).toBe(true);
    expect(res.searchOk).toBe(false);
    expect(res.topScore).toBe(0);
    expect(res.error).toBeUndefined();
    // mutation smoke: if the service indexed `hits[0]!` unsafely, an empty
    // array would throw a TypeError and .error would be populated.
  });
});

describe('EmbeddingsService.saveConfig / getConfig (B-8 coverage)', () => {
  it('seals the external API key before persisting it and requires dimensions', async () => {
    const prisma = makePrisma();
    const svc = new EmbeddingsService(prisma as never);
    const cfg: EmbeddingConfig = {
      mode: 'external',
      model: 'text-embedding-3-small',
      externalBaseUrl: 'https://x.example/v1',
      externalApiKey: 'sk-plaintext',
      dimensions: 1536,
    };
    await svc.saveConfig(cfg);
    expect(prisma.appConfig.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.appConfig.upsert.mock.calls[0]![0] as {
      where: { key: string };
      create: { key: string; value: EmbeddingConfig };
      update: { value: EmbeddingConfig };
    };
    expect(arg.where).toEqual({ key: 'embedding' });
    const stored = arg.create.value;
    expect(stored.mode).toBe('external');
    // Never persisted in the clear.
    expect(stored.externalApiKey).not.toBe('sk-plaintext');
    expect(stored.externalApiKey).toMatch(/^enc:v1:/);
  });

  it('rejects external mode without dimensions', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await expect(
      svc.saveConfig({
        mode: 'external',
        model: 'm',
        externalBaseUrl: 'https://x.example/v1',
        externalApiKey: 'k',
      }),
    ).rejects.toThrow(/dimensions/);
  });

  it('returns null when no row exists, and the decrypted value when it does', async () => {
    const prisma = makePrisma();
    prisma.appConfig.findUnique.mockResolvedValueOnce(null);
    const svc = new EmbeddingsService(prisma as never);
    expect(await svc.getConfig()).toBeNull();

    const cfg: EmbeddingConfig = { mode: 'local', model: 'stub' };
    prisma.appConfig.findUnique.mockResolvedValueOnce({ value: cfg });
    expect(await svc.getConfig()).toEqual(cfg);
  });

  it('never returns the plaintext API key from getEffectiveConfig (hasApiKey instead)', async () => {
    const prisma = makePrisma({
      mode: 'external',
      model: 'text-embedding-3-small',
      externalBaseUrl: 'https://x.example/v1',
      externalApiKey: 'sk-plaintext',
      dimensions: 1536,
    });
    const svc = new EmbeddingsService(prisma as never);
    const effective = await svc.getEffectiveConfig();
    expect(effective).toEqual({
      mode: 'external',
      model: 'text-embedding-3-small',
      externalBaseUrl: 'https://x.example/v1',
      dimensions: 1536,
      hasApiKey: true,
    });
    expect(JSON.stringify(effective)).not.toContain('sk-plaintext');
  });

  it('migrates a legacy plaintext key to a sealed one on read', async () => {
    const prisma = makePrisma({
      mode: 'external',
      model: 'm',
      externalBaseUrl: 'https://x.example/v1',
      externalApiKey: 'legacy-plaintext',
      dimensions: 3,
    });
    const svc = new EmbeddingsService(prisma as never);
    const cfg = await svc.getConfig();
    expect(cfg?.externalApiKey).toBe('legacy-plaintext');
    // The read wrote a sealed copy back.
    expect(prisma.appConfig.upsert).toHaveBeenCalled();
    const arg = prisma.appConfig.upsert.mock.calls.at(-1)![0] as {
      update: { value: EmbeddingConfig };
    };
    expect(arg.update.value.externalApiKey).toMatch(/^enc:v1:/);
  });
});
