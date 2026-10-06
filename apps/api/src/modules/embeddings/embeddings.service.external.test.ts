// Seam test: the saved `externalBaseUrl`/`externalApiKey`/`model`/`dimensions`
// must reach the external adapter constructor through `resolveProvider()`.
// `@careeros/embeddings` is mocked so no real HTTP/model work happens; the
// captured `externalConfig` is the assertion target.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
  captured: [] as Array<Record<string, unknown>>,
  embedThrow: null as Error | null,
}));

vi.mock('@careeros/embeddings', () => {
  class QdrantStore {
    async ping(): Promise<boolean> {
      return true;
    }
    async ensureCollection(): Promise<void> {}
    async upsert(): Promise<void> {}
    async search(): Promise<Array<{ id: number; score: number }>> {
      return [{ id: Date.now(), score: 1 }];
    }
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
  function createEmbeddingProvider(opts: Record<string, unknown>): {
    mode: string;
    model: string;
    dim: number;
    embed: (t: string) => Promise<number[]>;
  } {
    refs.captured.push(opts);
    const external = opts.externalConfig as { model?: string; dimensions?: number } | undefined;
    return {
      mode: (opts.mode as string) ?? 'deterministic',
      model: external?.model ?? 'stub',
      dim: external?.dimensions ?? 3,
      async embed(_t: string): Promise<number[]> {
        if (refs.embedThrow) throw refs.embedThrow;
        return [0.1, 0.2, 0.3];
      },
    };
  }
  function resolveEmbeddingMode(raw: string | undefined): string {
    return raw === 'external' || raw === 'deterministic' || raw === 'local' ? raw : 'local';
  }
  return {
    QdrantStore,
    createEmbeddingProvider,
    resolveEmbeddingMode,
    validateExternalEmbeddingConfig,
    EMBEDDING_API_KEY_PURPOSE: 'embedding.externalApiKey',
    EMBED_DIM: 384,
  };
});

import { BadRequestException } from '@nestjs/common';
import { EmbeddingsService, type EmbeddingConfig } from './embeddings.service';

function makePrisma(saved: EmbeddingConfig | null = null) {
  let value = saved;
  return {
    appConfig: {
      upsert: vi.fn(async (args: { create: { value: unknown } }) => {
        value = args.create.value as EmbeddingConfig;
        return {};
      }),
      findUnique: vi.fn(async () => (value ? { value } : null)),
    },
  };
}

beforeEach(() => {
  refs.captured = [];
  refs.embedThrow = null;
});

describe('EmbeddingsService external config validation', () => {
  it('rejects external mode without baseUrl/apiKey at save time', async () => {
    const svc = new EmbeddingsService(makePrisma() as never);
    await expect(
      svc.saveConfig({ mode: 'external', model: 'text-embedding-3-small' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.saveConfig({
        mode: 'external',
        model: 'm',
        externalBaseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toThrow(/externalApiKey/);
  });

  it('accepts a valid external config and persists it', async () => {
    const prisma = makePrisma();
    const svc = new EmbeddingsService(prisma as never);
    const cfg: EmbeddingConfig = {
      mode: 'external',
      model: 'text-embedding-3-small',
      externalBaseUrl: 'https://api.example.com/v1',
      externalApiKey: 'sk-live',
      dimensions: 1536,
    };
    await svc.saveConfig(cfg);
    expect(prisma.appConfig.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('EmbeddingsService.resolveProvider external seam', () => {
  it('constructs the adapter from the stored external config', async () => {
    const svc = new EmbeddingsService(
      makePrisma({
        mode: 'external',
        model: 'text-embedding-3-small',
        externalBaseUrl: 'https://api.example.com/v1',
        externalApiKey: 'sk-live',
        dimensions: 1536,
      }) as never,
    );
    const res = await svc.test('round-trip');
    expect(res.mode).toBe('external');
    expect(res.dim).toBe(1536);
    const opts = refs.captured.at(-1)!;
    expect(opts.mode).toBe('external');
    expect(opts.externalConfig).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-live',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
  });

  it('throws (never silent deterministic fallback) when external mode has no saved config', async () => {
    const previous = process.env.EMBEDDING_MODE;
    process.env.EMBEDDING_MODE = 'external';
    try {
      const svc = new EmbeddingsService(makePrisma(null) as never);
      await expect(svc.test('x')).rejects.toBeInstanceOf(BadRequestException);
      expect(refs.captured).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.EMBEDDING_MODE;
      else process.env.EMBEDDING_MODE = previous;
    }
  });

  it('surfaces the adapter error instead of falling back when the external call fails', async () => {
    refs.embedThrow = new Error('external embeddings: HTTP 401');
    const svc = new EmbeddingsService(
      makePrisma({
        mode: 'external',
        model: 'm',
        externalBaseUrl: 'https://api.example.com/v1',
        externalApiKey: 'bad',
        dimensions: 3,
      }) as never,
    );
    const res = await svc.test('x');
    expect(res.mode).toBe('external');
    expect(res.error).toContain('HTTP 401');
    expect(res.upsertOk).toBe(false);
  });
});
