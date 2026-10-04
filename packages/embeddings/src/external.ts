import { z } from 'zod';
import { retry, type RetryOptions } from '@careeros/shared';
import type { EmbeddingLogger, EmbeddingProvider } from './provider';

/**
 * OpenAI-compatible `/embeddings` adapter.
 *
 * The wire contract is the one used by OpenAI, Azure OpenAI, OpenRouter,
 * Together, vLLM and most self-hosted gateways:
 *
 *   POST {baseUrl}/embeddings
 *   { "model": "...", "input": "..." }
 *   -> { "data": [{ "embedding": [ ... ] }, ...], "model": "..." }
 *
 * `baseUrl` is expected to already include the version segment (e.g.
 * `https://api.openai.com/v1`) — we only append `/embeddings`.
 *
 * This adapter never silently degrades to the deterministic embedder: a
 * configured external backend that is unreachable (or returns the wrong
 * dimension) throws `ExternalEmbeddingError` so callers surface the failure
 * instead of quietly poisoning the vector space with semantic-free vectors.
 * Transient failures (network, 429, 5xx) are retried through the shared
 * `packages/shared/retry` policy; 4xx and shape/dimension errors fail fast.
 */

export class ExternalEmbeddingError extends Error {
  readonly status: number | undefined;
  /** Whether the shared retry policy should retry this failure. */
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = true) {
    super(message);
    this.name = 'ExternalEmbeddingError';
    if (status !== undefined) this.status = status;
    this.retryable = retryable;
  }
}

export interface ExternalEmbeddingConfig {
  /** Base URL including any version prefix, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Expected vector dimension. Optional — when omitted the dimension is
   * inferred from the first successful response and enforced from then on.
   * The API config layer requires it so Qdrant collections can be created
   * before the first embed.
   */
  dimensions?: number;
  /** Per-request timeout. Default 60s. */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Retry policy overrides (attempts/baseMs/...). Defaults to shared policy. */
  retry?: RetryOptions;
  logger?: EmbeddingLogger;
}

const EmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number()),
      }),
    )
    .min(1),
  model: z.string().optional(),
});

const DEFAULT_TIMEOUT_MS = 60_000;

/** Cross-field validation for the external config. Throws on anything invalid. */
export function validateExternalEmbeddingConfig(config: ExternalEmbeddingConfig): void {
  if (!config.baseUrl || config.baseUrl.trim().length === 0) {
    throw new ExternalEmbeddingError('external embeddings: baseUrl is required');
  }
  try {
    const parsed = new URL(config.baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new ExternalEmbeddingError(
      `external embeddings: baseUrl is not a valid URL: ${config.baseUrl}`,
    );
  }
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new ExternalEmbeddingError('external embeddings: apiKey is required');
  }
  if (!config.model || config.model.trim().length === 0) {
    throw new ExternalEmbeddingError('external embeddings: model is required');
  }
  if (
    config.dimensions !== undefined &&
    (!Number.isInteger(config.dimensions) || config.dimensions <= 0)
  ) {
    throw new ExternalEmbeddingError('external embeddings: dimensions must be a positive integer');
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly mode = 'external' as const;
  readonly model: string;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly declaredDim: number | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryOptions: RetryOptions;
  private readonly logger: EmbeddingLogger | undefined;
  /** Set from the first response when `dimensions` is not declared. */
  private inferredDim: number | undefined;

  constructor(config: ExternalEmbeddingConfig) {
    validateExternalEmbeddingConfig(config);
    this.endpoint = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.declaredDim = config.dimensions;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryOptions = config.retry ?? {};
    this.logger = config.logger;
  }

  get dim(): number {
    return this.declaredDim ?? this.inferredDim ?? 0;
  }

  async embed(text: string): Promise<number[]> {
    const vector = await retry(() => this.requestOnce(text), {
      ...this.retryOptions,
      shouldRetry: this.retryOptions.shouldRetry ?? shouldRetryExternal,
      onRetry: (err, attempt, delayMs) => {
        this.logger?.warn(
          { err: (err as Error).message, attempt, delayMs, model: this.model },
          'external embedding call failed; retrying',
        );
        this.retryOptions.onRetry?.(err, attempt, delayMs);
      },
    });

    // Dimension validation happens outside the retry wrapper: a mismatch is a
    // configuration/model problem, not a transient fault.
    const expected = this.declaredDim ?? this.inferredDim;
    if (expected !== undefined && vector.length !== expected) {
      throw new ExternalEmbeddingError(
        `external embeddings: dimension mismatch — expected ${expected}, got ${vector.length} (model ${this.model})`,
      );
    }
    if (this.inferredDim === undefined) this.inferredDim = vector.length;
    return vector;
  }

  private async requestOnce(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ExternalEmbeddingError(
        `external embeddings: request failed (${(err as Error).message})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await safeText(res);
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      throw new ExternalEmbeddingError(
        `external embeddings: HTTP ${res.status}${body ? ` — ${body}` : ''}`,
        res.status,
        retryable,
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new ExternalEmbeddingError(
        `external embeddings: response was not JSON (${(err as Error).message})`,
        undefined,
        false,
      );
    }
    const parsed = EmbeddingResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ExternalEmbeddingError(
        `external embeddings: malformed response (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`,
        undefined,
        false,
      );
    }
    const vector = parsed.data.data[0]!.embedding;
    if (vector.length === 0) {
      throw new ExternalEmbeddingError(
        'external embeddings: response contained an empty vector',
        undefined,
        false,
      );
    }
    return vector;
  }
}

/**
 * Provider-level retry policy (AGENTS.md §Retry & backoff): retry 429 + 5xx +
 * network; hard-fail any other 4xx and all malformed-shape / config errors.
 */
function shouldRetryExternal(err: unknown): boolean {
  if (err instanceof ExternalEmbeddingError) return err.retryable;
  return true;
}

export function createExternalEmbeddingProvider(
  config: ExternalEmbeddingConfig,
): OpenAICompatibleEmbeddingProvider {
  return new OpenAICompatibleEmbeddingProvider(config);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
