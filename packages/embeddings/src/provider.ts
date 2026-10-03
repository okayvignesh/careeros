/**
 * Embedding backend seam. Selects the effective encoder via `EMBEDDING_MODE`:
 *
 * - `local` (default): `Xenova/bge-small-en-v1.5` through `@xenova/transformers`.
 *   The pipeline is a lazy process-wide singleton; its **first** call downloads
 *   the model weights (~tens of MB) from Hugging Face into `cacheDir`
 *   (`EMBEDDING_MODEL_CACHE_DIR`, else the library default). Offline or a
 *   missing model throws, so this mode is wrapped in `FallbackEmbeddingProvider`.
 * - `deterministic`: the offline SHA-256 fallback in `local.ts`, never touches
 *   the network (useful for CI and fully air-gapped installs).
 * - `external`: a pluggable hosted adapter injected by the caller; no adapter
 *   ships in this package, so an unconfigured external mode degrades to
 *   deterministic with a warning.
 *
 * Callers should read `mode`/`model`/`dim` off the provider they actually got:
 * after a local failure the reported mode is `deterministic`, never a stale
 * `bge-small-en` claim. Dimension is always 384.
 */
import { EMBED_DIM, embedDeterministic } from './local';

/** Which embedding backend is active. `local` downloads model weights on first
 * use; `deterministic` never touches the network; `external` is a pluggable
 * seam with no adapter shipped in this package. */
export type EmbeddingMode = 'local' | 'deterministic' | 'external';

export const DEFAULT_EMBEDDING_MODE: EmbeddingMode = 'local';
export const BGE_SMALL_MODEL = 'Xenova/bge-small-en-v1.5';

/** Minimal pino-shaped logger. Kept structural so callers don't need a dep. */
export interface EmbeddingLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface EmbeddingProvider {
  readonly mode: EmbeddingMode;
  readonly model: string;
  readonly dim: number;
  embed(text: string): Promise<number[]>;
}

/** Explicit, offline-safe fallback. Stable 384-d unit vector from the input. */
export class DeterministicEmbedder implements EmbeddingProvider {
  readonly mode = 'deterministic' as const;
  readonly model = 'sha256-deterministic';
  readonly dim = EMBED_DIM;

  async embed(text: string): Promise<number[]> {
    return embedDeterministic(text);
  }
}

interface FeatureExtractionOutput {
  data: ArrayLike<number>;
}

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

interface TransformersModule {
  pipeline: (task: string, model: string) => Promise<unknown>;
  env: { cacheDir?: string; allowLocalModels?: boolean; allowRemoteModels?: boolean };
}

// One pipeline per (model, cacheDir): the model loads once per process, even
// when callers construct a fresh embedder per request.
const pipelineCache = new Map<string, Promise<FeatureExtractionPipeline>>();

/** Test-only: clears the lazy pipeline cache so failure paths can be rerun. */
export function __resetEmbeddingPipelineCache(): void {
  pipelineCache.clear();
}

async function loadPipeline(model: string, cacheDir?: string): Promise<FeatureExtractionPipeline> {
  const key = `${model}::${cacheDir ?? ''}`;
  const existing = pipelineCache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const mod = (await import('@xenova/transformers')) as unknown as TransformersModule;
    if (cacheDir) mod.env.cacheDir = cacheDir;
    return (await mod.pipeline('feature-extraction', model)) as FeatureExtractionPipeline;
  })().catch((e: unknown) => {
    // Drop the rejected promise so a later call can retry (e.g. network back).
    pipelineCache.delete(key);
    throw e;
  });
  pipelineCache.set(key, pending);
  return pending;
}

/** Legacy short names map to the pinned Hugging Face repo id. */
function canonicalModel(model?: string): string {
  if (!model) return BGE_SMALL_MODEL;
  if (model === 'bge-small-en' || model === 'bge-small-en-v1.5' || model === BGE_SMALL_MODEL) {
    return BGE_SMALL_MODEL;
  }
  return model;
}

export interface BgeSmallOptions {
  model?: string;
  cacheDir?: string;
}

/**
 * Local `bge-small-en-v1.5` via `@xenova/transformers`, lazy-loaded on first
 * `embed()`. The first real call fetches ~tens of MB of weights from Hugging
 * Face into `cacheDir` (default `EMBEDDING_MODEL_CACHE_DIR`, else the library
 * default). Offline / missing-model throws; callers should wrap with
 * `FallbackEmbeddingProvider` so runtime degrades instead of crashing.
 */
export class BgeSmallEmbedder implements EmbeddingProvider {
  readonly mode = 'local' as const;
  readonly model: string;
  readonly dim = EMBED_DIM;
  private readonly cacheDir: string | undefined;

  constructor(options: BgeSmallOptions = {}) {
    this.model = canonicalModel(options.model);
    this.cacheDir = options.cacheDir;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await loadPipeline(this.model, this.cacheDir);
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }
}

/**
 * Wraps a primary provider and permanently falls back to deterministic on the
 * first failure, logging a warning. `mode`/`model` report the effective backend
 * so callers never advertise `bge-small-en` after a fallback.
 */
export class FallbackEmbeddingProvider implements EmbeddingProvider {
  private current: EmbeddingProvider;

  constructor(
    private readonly primary: EmbeddingProvider,
    private readonly fallback: EmbeddingProvider,
    private readonly logger?: EmbeddingLogger,
  ) {
    this.current = primary;
  }

  get mode(): EmbeddingMode {
    return this.current.mode;
  }
  get model(): string {
    return this.current.model;
  }
  get dim(): number {
    return this.current.dim;
  }

  async embed(text: string): Promise<number[]> {
    try {
      return await this.current.embed(text);
    } catch (e) {
      const err = e as Error;
      this.logger?.warn(
        { err: err.message, model: this.current.model },
        'embedding provider unavailable; falling back to deterministic',
      );
      this.current = this.fallback;
      return this.current.embed(text);
    }
  }
}

export interface CreateEmbeddingProviderOptions {
  mode?: EmbeddingMode;
  model?: string;
  cacheDir?: string;
  logger?: EmbeddingLogger;
  /** Optional external adapter, used only when `mode === 'external'`. */
  external?: EmbeddingProvider;
}

/** Parse `EMBEDDING_MODE`; unknown/empty values fall back to the default. */
export function resolveEmbeddingMode(raw: string | undefined): EmbeddingMode {
  if (raw === 'local' || raw === 'deterministic' || raw === 'external') return raw;
  return DEFAULT_EMBEDDING_MODE;
}

export function createEmbeddingProvider(
  options: CreateEmbeddingProviderOptions = {},
): EmbeddingProvider {
  const mode = options.mode ?? DEFAULT_EMBEDDING_MODE;

  if (mode === 'deterministic') return new DeterministicEmbedder();

  if (mode === 'external') {
    if (options.external) return options.external;
    options.logger?.warn(
      { mode },
      'external embedding provider not configured; using deterministic fallback',
    );
    return new DeterministicEmbedder();
  }

  const bgeOptions: BgeSmallOptions = {};
  if (options.model) bgeOptions.model = options.model;
  if (options.cacheDir) bgeOptions.cacheDir = options.cacheDir;
  const local = new BgeSmallEmbedder(bgeOptions);
  return new FallbackEmbeddingProvider(local, new DeterministicEmbedder(), options.logger);
}
