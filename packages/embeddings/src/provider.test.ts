// Encoder-contract tests for the EmbeddingProvider layer. `@xenova/transformers`
// is fully mocked (no network, no weight download): the pipeline factory returns
// a controllable fake extractor, so we can assert the local path calls the
// pipeline and that failures degrade to the deterministic vector.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
  pipelineCalls: [] as Array<{ task: string; model: string }>,
  inferenceCalls: [] as string[],
  failLoad: false,
  failInference: false,
  vector: new Float32Array(384).fill(0.25),
}));

vi.mock('@xenova/transformers', () => ({
  env: { cacheDir: '' },
  pipeline: vi.fn(async (task: string, model: string) => {
    refs.pipelineCalls.push({ task, model });
    if (refs.failLoad) throw new Error('model download failed');
    return async (text: string) => {
      refs.inferenceCalls.push(text);
      if (refs.failInference) throw new Error('inference failed');
      return { data: refs.vector };
    };
  }),
}));

import {
  BgeSmallEmbedder,
  DeterministicEmbedder,
  createEmbeddingProvider,
  resolveEmbeddingMode,
  __resetEmbeddingPipelineCache,
  type EmbeddingLogger,
} from './provider';
import { EMBED_DIM, embedDeterministic } from './local';

function makeLogger() {
  const warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const logger: EmbeddingLogger = {
    warn: (obj, msg) => {
      warns.push({ obj, msg });
    },
  };
  return { logger, warns };
}

beforeEach(() => {
  refs.pipelineCalls = [];
  refs.inferenceCalls = [];
  refs.failLoad = false;
  refs.failInference = false;
  __resetEmbeddingPipelineCache();
});

describe('BgeSmallEmbedder', () => {
  it('lazy-loads the feature-extraction pipeline and returns its vector', async () => {
    const embedder = new BgeSmallEmbedder();
    const vec = await embedder.embed('hello');

    expect(refs.pipelineCalls).toEqual([
      { task: 'feature-extraction', model: 'Xenova/bge-small-en-v1.5' },
    ]);
    expect(refs.inferenceCalls).toEqual(['hello']);
    expect(vec).toEqual(Array.from(refs.vector));
    expect(vec).toHaveLength(EMBED_DIM);
    expect(embedder.mode).toBe('local');
  });

  it('maps legacy short model names to the pinned Hugging Face repo', () => {
    expect(new BgeSmallEmbedder({ model: 'bge-small-en' }).model).toBe(
      'Xenova/bge-small-en-v1.5',
    );
  });

  it('reuses one pipeline across embedder instances (loads once per process)', async () => {
    await new BgeSmallEmbedder().embed('one');
    await new BgeSmallEmbedder().embed('two');
    expect(refs.pipelineCalls).toHaveLength(1);
  });
});

describe('DeterministicEmbedder', () => {
  it('returns the hash-based vector without touching the pipeline', async () => {
    const vec = await new DeterministicEmbedder().embed('stable input');
    expect(vec).toEqual(embedDeterministic('stable input'));
    expect(refs.pipelineCalls).toHaveLength(0);
  });
});

describe('createEmbeddingProvider mode selection', () => {
  it('local mode wraps bge with fallback and reports local while healthy', async () => {
    const { logger, warns } = makeLogger();
    const provider = createEmbeddingProvider({ mode: 'local', logger });
    const vec = await provider.embed('semantic');
    expect(vec).toEqual(Array.from(refs.vector));
    expect(provider.mode).toBe('local');
    expect(provider.model).toBe('Xenova/bge-small-en-v1.5');
    expect(warns).toHaveLength(0);
  });

  it('deterministic mode never calls the pipeline', async () => {
    const provider = createEmbeddingProvider({ mode: 'deterministic' });
    const vec = await provider.embed('offline');
    expect(vec).toEqual(embedDeterministic('offline'));
    expect(provider.mode).toBe('deterministic');
    expect(refs.pipelineCalls).toHaveLength(0);
  });

  it('external mode throws (never silently degrades) when no adapter is wired', async () => {
    const { logger } = makeLogger();
    expect(() => createEmbeddingProvider({ mode: 'external', logger })).toThrow(
      /no external provider\/config/i,
    );
  });

  it('external mode uses an injected adapter when provided', async () => {
    const external = new DeterministicEmbedder();
    const provider = createEmbeddingProvider({ mode: 'external', external });
    expect(provider).toBe(external);
  });
});

describe('fallback behaviour', () => {
  it('falls back to the deterministic vector when inference fails, and reports the real mode', async () => {
    refs.failInference = true;
    const { logger, warns } = makeLogger();
    const provider = createEmbeddingProvider({ mode: 'local', logger });

    const vec = await provider.embed('boom');
    expect(vec).toEqual(embedDeterministic('boom'));
    expect(provider.mode).toBe('deterministic');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.msg).toMatch(/falling back to deterministic/i);
  });

  it('falls back cleanly when the model cannot be loaded (offline) instead of throwing', async () => {
    refs.failLoad = true;
    const { logger, warns } = makeLogger();
    const provider = createEmbeddingProvider({ mode: 'local', logger });

    await expect(provider.embed('offline')).resolves.toEqual(embedDeterministic('offline'));
    expect(provider.mode).toBe('deterministic');
    expect(warns).toHaveLength(1);
  });
});

describe('resolveEmbeddingMode', () => {
  it('accepts the three documented modes and defaults unknown/empty to local', () => {
    expect(resolveEmbeddingMode('local')).toBe('local');
    expect(resolveEmbeddingMode('deterministic')).toBe('deterministic');
    expect(resolveEmbeddingMode('external')).toBe('external');
    expect(resolveEmbeddingMode('nonsense')).toBe('local');
    expect(resolveEmbeddingMode(undefined)).toBe('local');
  });
});
