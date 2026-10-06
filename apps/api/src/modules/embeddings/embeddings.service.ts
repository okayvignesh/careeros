import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  QdrantStore,
  createEmbeddingProvider,
  resolveEmbeddingMode,
  validateExternalEmbeddingConfig,
  EMBEDDING_API_KEY_PURPOSE,
  type CreateEmbeddingProviderOptions,
  type EmbeddingLogger,
  type EmbeddingProvider,
  type ExternalEmbeddingConfig,
} from '@careeros/embeddings';
import {
  encryptField,
  decryptField,
  isEncryptedField,
  loadMasterKey,
} from '@careeros/secrets';
import type { EmbeddingMode } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://qdrant:6333';
const TEST_COLLECTION = '_setup_test';
const EMBEDDING_KEY = 'embedding';

export interface EmbeddingConfig {
  mode: EmbeddingMode;
  model: string;
  externalBaseUrl?: string | undefined;
  /**
   * Plaintext API key accepted on write only. It is sealed with
   * `packages/secrets` (AES-GCM) before it touches `app_config`, and is never
   * returned by the API — see `EffectiveEmbeddingConfig.hasApiKey`.
   */
  externalApiKey?: string | undefined;
  /** Expected vector dimension for `external` mode; validated against the API. */
  dimensions?: number | undefined;
}

/** Client-safe view of the saved config: no plaintext, just key presence. */
export interface EffectiveEmbeddingConfig {
  mode: EmbeddingMode;
  model: string;
  externalBaseUrl?: string | undefined;
  dimensions?: number | undefined;
  hasApiKey: boolean;
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
    // Reject an unusable external config at save time rather than letting it
    // silently degrade later. `mode: 'external'` needs a base URL + key; a
    // declared dimension is required so collections can be created for the
    // right vector size before the first call.
    let toPersist: EmbeddingConfig;
    if (cfg.mode === 'external') {
      if (!cfg.externalBaseUrl) {
        throw new BadRequestException('external embedding mode requires externalBaseUrl');
      }
      const sealedKey = await this.sealApiKeyForSave(cfg);
      if (cfg.dimensions === undefined) {
        throw new BadRequestException(
          'external embedding mode requires dimensions (the model vector size) so collections match',
        );
      }
      try {
        const external: ExternalEmbeddingConfig = {
          baseUrl: cfg.externalBaseUrl,
          apiKey: cfg.externalApiKey ?? this.unsealApiKey(sealedKey),
          model: cfg.model,
          dimensions: cfg.dimensions,
        };
        validateExternalEmbeddingConfig(external);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
      toPersist = { ...cfg, externalApiKey: sealedKey };
    } else {
      // Never keep a key beside a non-external mode.
      toPersist = { mode: cfg.mode, model: cfg.model };
      if (cfg.externalBaseUrl) toPersist.externalBaseUrl = cfg.externalBaseUrl;
      if (cfg.dimensions !== undefined) toPersist.dimensions = cfg.dimensions;
    }
    await this.prisma.appConfig.upsert({
      where: { key: EMBEDDING_KEY },
      create: { key: EMBEDDING_KEY, value: toPersist as unknown as object },
      update: { value: toPersist as unknown as object },
    });
  }

  /** Resolve the sealed API key to persist, reusing the stored one when omitted. */
  private async sealApiKeyForSave(cfg: EmbeddingConfig): Promise<string> {
    if (cfg.externalApiKey) {
      return this.sealApiKey(cfg.externalApiKey);
    }
    const stored = await this.readStoredShape();
    const existing = stored?.externalApiKey;
    if (!existing) {
      throw new BadRequestException(
        'external embedding mode requires externalApiKey (none is stored yet)',
      );
    }
    return isEncryptedField(existing) ? existing : this.sealApiKey(existing);
  }

  /** Internal, decrypted view. Prefer `getEffectiveConfig()` for anything client-facing. */
  async getConfig(): Promise<EmbeddingConfig | null> {
    return this.loadStoredConfig();
  }

  /** Raw `app_config.value` shape (API key still sealed) or null. */
  private async readStoredShape(): Promise<EmbeddingConfig | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: EMBEDDING_KEY } });
    const value = row?.value;
    if (!value || typeof value !== 'object') return null;
    return value as unknown as EmbeddingConfig;
  }

  /**
   * Read the saved config and unseal the API key. A legacy plaintext key is
   * migrated to a sealed one on first read (once per process) so it stops
   * living in `app_config` in the clear.
   */
  private async loadStoredConfig(): Promise<EmbeddingConfig | null> {
    const cfg = await this.readStoredShape();
    if (!cfg) return null;
    const out: EmbeddingConfig = { ...cfg };
    if (cfg.externalApiKey) {
      if (isEncryptedField(cfg.externalApiKey)) {
        out.externalApiKey = this.unsealApiKey(cfg.externalApiKey);
      } else if (!this.plaintextMigrated) {
        this.plaintextMigrated = true;
        const sealed = this.sealApiKey(cfg.externalApiKey);
        await this.prisma.appConfig
          .upsert({
            where: { key: EMBEDDING_KEY },
            create: {
              key: EMBEDDING_KEY,
              value: { ...cfg, externalApiKey: sealed } as unknown as object,
            },
            update: { value: { ...cfg, externalApiKey: sealed } as unknown as object },
          })
          .catch(() => {
            // Best-effort: a read must not fail because the migration write did.
          });
      }
    }
    return out;
  }

  private plaintextMigrated = false;

  private sealApiKey(plaintext: string): string {
    return encryptField(plaintext, loadMasterKey(), EMBEDDING_API_KEY_PURPOSE);
  }

  private unsealApiKey(stored: string): string {
    return decryptField(stored, loadMasterKey(), EMBEDDING_API_KEY_PURPOSE);
  }

  /** Saved config for the settings editor, or the env/default provider shape. Never the key. */
  async getEffectiveConfig(): Promise<EffectiveEmbeddingConfig> {
    const cfg = await this.loadStoredConfig();
    if (cfg) {
      const out: EffectiveEmbeddingConfig = {
        mode: cfg.mode,
        model: cfg.model,
        hasApiKey: typeof cfg.externalApiKey === 'string' && cfg.externalApiKey.length > 0,
      };
      if (cfg.externalBaseUrl) out.externalBaseUrl = cfg.externalBaseUrl;
      if (cfg.dimensions !== undefined) out.dimensions = cfg.dimensions;
      return out;
    }
    const provider = await this.resolveProvider();
    return { mode: provider.mode, model: provider.model, hasApiKey: false };
  }

  async test(sampleText = 'Career OS embedding round-trip check'): Promise<TestResult> {
    const provider = await this.resolveProvider();
    const base = { mode: provider.mode, model: provider.model };

    const t0 = Date.now();
    const reachable = await this.store.ping();
    if (!reachable) {
      return {
        ...base,
        dim: provider.dim,
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
      // Embed first: an external provider without a declared dimension only
      // knows its size after the first response, and Qdrant must be created
      // with the real size.
      // Embed a unique string per run. The embedder is deterministic for a
      // given text, so reusing `sampleText` makes every prior test point an
      // exact tie (score 1.0) and the top-1 hit can be an old point rather than
      // the one inserted here. A per-run id keeps the round-trip unambiguous.
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const uniqueText = `${sampleText} [${runId}]`;
      const vec = await provider.embed(uniqueText);
      const dim = provider.dim || vec.length;
      await this.store.ensureCollection(TEST_COLLECTION, dim);
      const id = Date.now();
      await this.store.upsert(TEST_COLLECTION, [
        { id, vector: vec, payload: { text: uniqueText, runId } },
      ]);
      const hits = await this.store.search(TEST_COLLECTION, vec, 1);
      const top = hits[0];
      const upsertOk = true;
      const searchOk = !!top && top.id === id && top.score > 0.99;
      return {
        ...base,
        dim,
        qdrantReachable: true,
        qdrantLatencyMs,
        upsertOk,
        searchOk,
        topScore: top?.score ?? 0,
      };
    } catch (e) {
      return {
        ...base,
        dim: provider.dim,
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
   *
   * `external` mode is only honoured with a real base URL + key. A configured
   * external mode never silently degrades: a missing config throws here, and a
   * runtime API failure propagates from the adapter.
   */
  private async resolveProvider(): Promise<EmbeddingProvider> {
    const cfg = await this.getConfig();
    const mode = cfg?.mode ?? resolveEmbeddingMode(process.env.EMBEDDING_MODE);

    const opts: CreateEmbeddingProviderOptions = { mode, logger: this.embedLogger };
    if (cfg?.model) opts.model = cfg.model;
    const cacheDir = process.env.EMBEDDING_MODEL_CACHE_DIR;
    if (cacheDir) opts.cacheDir = cacheDir;

    if (mode === 'external') {
      if (!cfg) {
        throw new BadRequestException(
          'external embedding mode is enabled but no embedding config is saved; set externalBaseUrl and externalApiKey',
        );
      }
      try {
        opts.externalConfig = this.buildExternalConfig(cfg);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }

    return createEmbeddingProvider(opts);
  }

  /** Marshal the saved config into the adapter's `ExternalEmbeddingConfig`. */
  private buildExternalConfig(cfg: EmbeddingConfig): ExternalEmbeddingConfig {
    const external: ExternalEmbeddingConfig = {
      baseUrl: cfg.externalBaseUrl ?? '',
      apiKey: cfg.externalApiKey ?? '',
      model: cfg.model,
      logger: this.embedLogger,
    };
    if (cfg.dimensions !== undefined) external.dimensions = cfg.dimensions;
    validateExternalEmbeddingConfig(external);
    return external;
  }
}
