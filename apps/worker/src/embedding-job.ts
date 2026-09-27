// embedding.generate job handler. Chunks the input text, embeds each chunk, and
// upserts to the target Qdrant collection. Idempotent by content hash: repeating
// the same (sourceId, chunk_idx, hash) upsert is a no-op even across worker restarts.
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { QdrantStore, embedDeterministic } from '@careeros/embeddings';
import {
  ALL_COLLECTIONS,
  chunkText,
  type BasePointPayload,
  type EmbeddingGeneratePayload,
} from '@careeros/shared';

export async function handleEmbeddingGenerate(
  qdrant: QdrantStore,
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

  const now = new Date().toISOString();
  const points = chunks.map((c) => {
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
    return { id: pointId, vector: embedDeterministic(c.text), payload };
  });

  await qdrant.upsert(collection, points);
  child.info({ chunks: points.length }, 'embedded + upserted');
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
