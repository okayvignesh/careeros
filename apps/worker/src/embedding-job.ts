// embedding.generate job handler. Chunks the input text, embeds each chunk through
// the process-wide EmbeddingProvider seam, and upserts to the target Qdrant
// collection. Idempotent by content hash: repeating the same
// (sourceId, chunk_idx, hash) upsert is a no-op even across worker restarts.
//
// The effective mode/model/dimension are resolved from `app_config` (the
// settings UI's saved embedding config), falling back to `EMBEDDING_MODE`. An
// external config saved with a 1536-d model therefore produces 1536-d vectors
// here too; `external` without a saved config throws instead of degrading to
// deterministic. Vectors written before a provider switch are stale — re-enqueue
// their `embedding.generate` jobs (settings "Re-embed" / `POST /embeddings/reembed`).
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import {
  createProviderFromResolved,
  loadResolvedEmbeddingConfig,
  EMBEDDING_API_KEY_PURPOSE,
  type EmbeddingConfigRepo,
  type EmbeddingLogger,
  type EmbeddingProvider,
  type QdrantStore,
  type ResolvedEmbeddingConfig,
} from '@careeros/embeddings';
import { decryptField, loadMasterKey } from '@careeros/secrets';
import {
  ALL_COLLECTIONS,
  chunkText,
  type BasePointPayload,
  type EmbeddingGeneratePayload,
} from '@careeros/shared';

/** Decrypt a sealed `app_config` API key; plaintext legacy values pass through. */
export function decryptEmbeddingApiKey(stored: string): string {
  return decryptField(stored, loadMasterKey(), EMBEDDING_API_KEY_PURPOSE);
}

/**
 * Process-wide provider, rebuilt only when the resolved config signature
 * changes (settings edit). The BGE pipeline itself is a process-wide singleton
 * inside the package, so a rebuild does not re-download weights.
 */
let cached: { key: string; provider: EmbeddingProvider; dim: number } | undefined;

function configKey(resolved: ResolvedEmbeddingConfig): string {
  return [
    resolved.mode,
    resolved.model,
    resolved.dim,
    resolved.external?.baseUrl ?? '',
    resolved.hasApiKey ? 'key' : 'nokey',
  ].join('|');
}

async function resolveEmbeddingProvider(
  prisma: EmbeddingConfigRepo,
  logger: EmbeddingLogger,
): Promise<{ provider: EmbeddingProvider; dim: number }> {
  const cacheDir = process.env.EMBEDDING_MODEL_CACHE_DIR;
  const resolved = await loadResolvedEmbeddingConfig(prisma, {
    envMode: process.env.EMBEDDING_MODE,
    decryptApiKey: decryptEmbeddingApiKey,
    logger,
  });
  const key = configKey(resolved);
  if (cached?.key === key) return cached;
  const provider = createProviderFromResolved(resolved, {
    logger,
    ...(cacheDir ? { cacheDir } : {}),
  });
  cached = { key, provider, dim: resolved.dim };
  return cached;
}

export async function handleEmbeddingGenerate(
  qdrant: QdrantStore,
  prisma: EmbeddingConfigRepo,
  logger: Logger,
  payload: EmbeddingGeneratePayload,
): Promise<{ chunks: number; skipped: number }> {
  const { userId, collection, sourceId, sourceKind, text, sensitivity, meta } = payload;
  const child = logger.child({ userId, collection, sourceId, sourceKind, job: 'embedding.generate' });

  const def = ALL_COLLECTIONS.find((c) => c.name === collection);
  if (!def) {
    child.warn({ collection }, 'unknown collection; dropping job');
    return { chunks: 0, skipped: 0 };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    child.info('empty input, nothing to embed');
    return { chunks: 0, skipped: 0 };
  }

  const { provider: embed, dim } = await resolveEmbeddingProvider(prisma, child);

  // Keep the collection aligned with the *current* effective dimension. A
  // settings change to a differently-sized external model recreates the
  // collection here (and on the next bootstrap), so the upsert never fails on a
  // dimension mismatch.
  const outcome = await qdrant.ensureCollection(collection, dim, {
    recreateOnMismatch: true,
    logger: child,
  });
  if (outcome === 'recreated') {
    child.warn(
      { collection, dim },
      'qdrant collection recreated at a new embedding dimension; previously stored vectors were dropped — re-enqueue embedding.generate for this collection (Settings → Re-embed)',
    );
  }

  const now = new Date().toISOString();
  const points: Array<{
    id: string;
    vector: number[];
    payload: BasePointPayload & Record<string, unknown>;
  }> = [];
  for (const c of chunks) {
    const hash = createHash('sha256').update(c.text).digest('hex').slice(0, 16);
    const pointId = deterministicUuid(`${collection}:${sourceId}:${c.idx}:${hash}`);
    const payload: BasePointPayload & Record<string, unknown> = {
      user_id: userId,
      sensitivity,
      source_id: sourceId,
      source_kind: sourceKind,
      chunk_idx: c.idx,
      hash,
      timestamp: now,
      ...(meta ?? {}),
    };
    const vector = await embed.embed(c.text);
    if (vector.length !== dim) {
      throw new Error(
        `embedding dimension mismatch: provider produced ${vector.length}, collection '${collection}' expects ${dim}`,
      );
    }
    points.push({ id: pointId, vector, payload });
  }

  await qdrant.upsert(collection, points);
  child.info({ chunks: points.length, dim }, 'embedded + upserted');
  return { chunks: points.length, skipped: 0 };
}

/**
 * Turn any string into a deterministic UUID (v5-like: sha256 → shape into UUID form).
 * Qdrant point IDs must be unsigned int or UUID; strings that aren't UUIDs get rejected.
 */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  // Format as canonical UUID (8-4-4-4-12) using the first 32 hex chars.
  // Set version=5 nibble at position 12 and variant nibble (8-b) at position 16.
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  const v = chars[16]!;
  const variantNibble = ((parseInt(v, 16) & 0x3) | 0x8).toString(16);
  chars[16] = variantNibble;
  const s = chars.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
