import { z } from 'zod';
import { EMBED_DIM } from './local';
import {
  BGE_SMALL_MODEL,
  EmbeddingConfigError,
  createEmbeddingProvider,
  resolveEmbeddingMode,
  type CreateEmbeddingProviderOptions,
  type EmbeddingLogger,
  type EmbeddingMode,
  type EmbeddingProvider,
} from './provider';
import {
  validateExternalEmbeddingConfig,
  type ExternalEmbeddingConfig,
} from './external';

/**
 * Resolver for the *effective* embedding config. This is the one place that
 * reads `app_config` (or an env fallback), validates it, decrypts the sealed
 * API key, and hands back both the provider and the vector dimension every
 * Qdrant collection must be created at.
 *
 * It exists because `EMBEDDING_MODE` alone is not the source of truth: the
 * settings UI can save an `external` config (baseUrl / key / model / dims) that
 * the worker and search paths must honour. Reading env only there produced
 * 384-d deterministic vectors against a 1536-d collection and Qdrant rejected
 * the upsert.
 *
 * The resolver is Prisma-agnostic (takes a tiny repo shape) and secret-agnostic
 * (the caller injects `decryptApiKey`), so `packages/embeddings` keeps its
 * dependency surface unchanged while worker + API share one code path.
 */

/** `app_config.key` under which the API persists the embedding settings. */
export const EMBEDDING_CONFIG_KEY = 'embedding';

/** Purpose string used to seal `externalApiKey` with `packages/secrets`. */
export const EMBEDDING_API_KEY_PURPOSE = 'embedding.externalApiKey';

/**
 * Stored shape. `externalApiKey` may be plaintext (legacy) or an `enc:v1:` seal;
 * the `max(4096)` accepts ciphertext (base64 of iv+tag+ct grows ~4/3).
 */
export const StoredEmbeddingConfigSchema = z.object({
  mode: z.enum(['local', 'deterministic', 'external']),
  model: z.string().min(1).max(200).optional(),
  externalBaseUrl: z.string().min(1).max(2048).optional(),
  externalApiKey: z.string().min(1).max(4096).optional(),
  dimensions: z.number().int().positive().max(8192).optional(),
});
export type StoredEmbeddingConfig = z.infer<typeof StoredEmbeddingConfigSchema>;

export { EmbeddingConfigError };

/** Minimal Prisma slice the resolver needs. Both api + worker PrismaClients satisfy it. */
export interface EmbeddingConfigRepo {
  appConfig: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
}

export interface ResolvedEmbeddingConfig {
  mode: EmbeddingMode;
  model: string;
  /** Vector dimension to create/validate collections at. */
  dim: number;
  /** True when an external API key is configured (never the key itself). */
  hasApiKey: boolean;
  /** Present only for `mode === 'external'`. */
  external: ExternalEmbeddingConfig | undefined;
  /** Where the mode came from — `app_config` beats the env fallback. */
  source: 'app_config' | 'env';
}

export interface ResolveEmbeddingConfigOptions {
  /** `process.env.EMBEDDING_MODE` fallback when no `app_config` row exists. */
  envMode?: string | undefined;
  /**
   * Seal-aware reader. Receives the stored value and returns plaintext.
   * Defaults to identity (plaintext stored value). Callers pass
   * `(v) => decryptField(v, loadMasterKey(), EMBEDDING_API_KEY_PURPOSE)`.
   */
  decryptApiKey?: ((stored: string) => string) | undefined;
  logger?: EmbeddingLogger | undefined;
}

function defaultModelFor(mode: Exclude<EmbeddingMode, 'external'>): string {
  return mode === 'local' ? BGE_SMALL_MODEL : 'sha256-deterministic';
}

/** Parse an `app_config.value` payload; null when there is no usable config. */
export function normalizeEmbeddingConfig(raw: unknown): StoredEmbeddingConfig | null {
  if (raw == null) return null;
  const parsed = StoredEmbeddingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EmbeddingConfigError(
      `saved embedding config is invalid: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data;
}

/**
 * Resolve from a raw stored value (sync, no DB). `external` without a usable
 * config throws `EmbeddingConfigError` — it never degrades to deterministic.
 */
export function resolveEmbeddingConfig(
  raw: unknown,
  opts: ResolveEmbeddingConfigOptions = {},
): ResolvedEmbeddingConfig {
  const decrypt = opts.decryptApiKey ?? ((v: string) => v);
  const cfg = normalizeEmbeddingConfig(raw);

  if (!cfg) {
    const mode = resolveEmbeddingMode(opts.envMode);
    if (mode === 'external') {
      throw new EmbeddingConfigError(
        'external embedding mode is enabled but no embedding config is saved in app_config. ' +
          'Set externalBaseUrl, externalApiKey, and dimensions in Settings before enabling it.',
      );
    }
    return {
      mode,
      model: defaultModelFor(mode),
      dim: EMBED_DIM,
      hasApiKey: false,
      external: undefined,
      source: 'env',
    };
  }

  if (cfg.mode === 'external') {
    if (!cfg.externalBaseUrl || !cfg.externalApiKey) {
      throw new EmbeddingConfigError(
        'external embedding mode requires externalBaseUrl and externalApiKey',
      );
    }
    if (cfg.dimensions === undefined) {
      throw new EmbeddingConfigError(
        'external embedding mode requires dimensions so Qdrant collections can be created before the first call',
      );
    }
    const external: ExternalEmbeddingConfig = {
      baseUrl: cfg.externalBaseUrl,
      apiKey: decrypt(cfg.externalApiKey),
      model: cfg.model ?? '',
      dimensions: cfg.dimensions,
    };
    if (opts.logger) external.logger = opts.logger;
    validateExternalEmbeddingConfig(external);
    return {
      mode: 'external',
      model: external.model,
      dim: cfg.dimensions,
      hasApiKey: true,
      external,
      source: 'app_config',
    };
  }

  return {
    mode: cfg.mode,
    model: cfg.model ?? defaultModelFor(cfg.mode),
    dim: EMBED_DIM,
    hasApiKey: false,
    external: undefined,
    source: 'app_config',
  };
}

/** Read the `app_config` row, then resolve (async DB wrapper). */
export async function loadResolvedEmbeddingConfig(
  repo: EmbeddingConfigRepo,
  opts: ResolveEmbeddingConfigOptions = {},
): Promise<ResolvedEmbeddingConfig> {
  const row = await repo.appConfig.findUnique({ where: { key: EMBEDDING_CONFIG_KEY } });
  return resolveEmbeddingConfig(row?.value ?? null, opts);
}

/**
 * Build the provider named by a resolved config. Local mode stays wrapped in
 * the deterministic fallback (offline-safe); external never falls back.
 */
export function createProviderFromResolved(
  resolved: ResolvedEmbeddingConfig,
  opts: { logger?: EmbeddingLogger; cacheDir?: string } = {},
): EmbeddingProvider {
  const providerOpts: CreateEmbeddingProviderOptions = { mode: resolved.mode };
  if (opts.logger) providerOpts.logger = opts.logger;
  if (opts.cacheDir) providerOpts.cacheDir = opts.cacheDir;
  if (resolved.mode === 'external') {
    if (!resolved.external) {
      throw new EmbeddingConfigError('resolved external mode is missing its external config');
    }
    providerOpts.externalConfig = resolved.external;
  } else {
    providerOpts.model = resolved.model;
  }
  return createEmbeddingProvider(providerOpts);
}
