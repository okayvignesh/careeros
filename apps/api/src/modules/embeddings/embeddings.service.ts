import { Injectable, Logger } from '@nestjs/common';
import {
  QdrantStore,
  createEmbeddingProvider,
  resolveEmbeddingMode,
  type CreateEmbeddingProviderOptions,
  type EmbeddingLogger,
  type EmbeddingProvider,
} from '@careeros/embeddings';
import type { EmbeddingMode } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://qdrant:6333';
const TEST_COLLECTION = '_setup_test';

export interface EmbeddingConfig {
  mode: EmbeddingMode;
  model: string;
  externalBaseUrl?: string | undefined;
  externalApiKey?: string | undefined;
}

export interface TestResult {
  qdrantReachable: boolean;
  qdrantLatencyMs: number;
  upsertOk: boolean;
  searchOk: boolean;
  topScore: number;
  /** Effective backend after any fallback, not just the configured mode. */
  mode: EmbeddingMode;
  model: string;
  dim: number;
  error?: string;
}

@Injectable()
export class EmbeddingsService {
  private store = new QdrantStore(QDRANT_URL);

  private readonly log = new Logger(EmbeddingsService.name);
  private readonly embedLogger: EmbeddingLogger = {
    warn: (obj, msg) => this.log.warn(`${msg} ${JSON.stringify(obj)}`),
  };

  constructor(private readonly prisma: PrismaService) {}

  async saveConfig(cfg: EmbeddingConfig): Promise<void> {
    await this.prisma.appConfig.upsert({
      where: { key: 'embedding' },
      create: { key: 'embedding', value: cfg as unknown as object },
      update: { value: cfg as unknown as object },
    });
  }

  async getConfig(): Promise<EmbeddingConfig | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: 'embedding' } });
    return (row?.value as unknown as EmbeddingConfig) ?? null;
  }

  /** Saved config for the settings editor, or the env/default provider shape. */
  async getEffectiveConfig(): Promise<EmbeddingConfig> {
    const cfg = await this.getConfig();
    if (cfg) return cfg;
    const provider = await this.resolveProvider();
    return { mode: provider.mode, model: provider.model };
  }

  async test(sampleText = 'Career OS embedding round-trip check'): Promise<TestResult> {
    const provider = await this.resolveProvider();
    const base = { mode: provider.mode, model: provider.model, dim: provider.dim };

    const t0 = Date.now();
    const reachable = await this.store.ping();
    if (!reachable) {
      return {
        ...base,
        qdrantReachable: false,
        qdrantLatencyMs: Date.now() - t0,
        upsertOk: false,
        searchOk: false,
        topScore: 0,
        error: 'Qdrant unreachable',
      };
    }
    const qdrantLatencyMs = Date.now() - t0;

    try {
      await this.store.ensureCollection(TEST_COLLECTION, provider.dim);
      const vec = await provider.embed(sampleText);
      const id = Date.now();
      await this.store.upsert(TEST_COLLECTION, [
        { id, vector: vec, payload: { text: sampleText } },
      ]);
      const hits = await this.store.search(TEST_COLLECTION, vec, 1);
      const top = hits[0];
      const upsertOk = true;
      const searchOk = !!top && top.id === id && top.score > 0.99;
      return {
        ...base,
        qdrantReachable: true,
        qdrantLatencyMs,
        upsertOk,
        searchOk,
        topScore: top?.score ?? 0,
      };
    } catch (e) {
      return {
        ...base,
        qdrantReachable: true,
        qdrantLatencyMs,
        upsertOk: false,
        searchOk: false,
        topScore: 0,
        error: (e as Error).message,
      };
    }
  }

  /**
   * Resolve the active provider from the saved config, else `EMBEDDING_MODE`
   * (default `local`). The local BGE provider is wrapped so an offline/missing
   * model falls back to the deterministic embedder with a warning.
   */
  private async resolveProvider(): Promise<EmbeddingProvider> {
    const cfg = await this.getConfig();
    const mode = cfg?.mode ?? resolveEmbeddingMode(process.env.EMBEDDING_MODE);

    const opts: CreateEmbeddingProviderOptions = { mode, logger: this.embedLogger };
    if (cfg?.model) opts.model = cfg.model;
    const cacheDir = process.env.EMBEDDING_MODEL_CACHE_DIR;
    if (cacheDir) opts.cacheDir = cacheDir;

    return createEmbeddingProvider(opts);
  }
}
