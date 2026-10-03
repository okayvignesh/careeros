import { createHash } from 'node:crypto';

/**
 * Offline-safe fallback embedder: a stable, L2-normalized 384-d vector derived
 * from a SHA-256 of the input. It carries no semantics; it exists so the wizard
 * round-trip and CI stay green when the real local model is unavailable.
 *
 * Semantic embeddings come from `BgeSmallEmbedder` in `provider.ts`
 * (`Xenova/bge-small-en-v1.5` via `@xenova/transformers`). That provider is
 * lazy-loaded on first `embed()` and downloads model weights from Hugging Face
 * into its cache dir on first use — see the `provider.ts` module doc.
 */
export const EMBED_DIM = 384;

export function embedDeterministic(text: string): number[] {
  const seed = createHash('sha256').update(text).digest();
  const vec: number[] = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) {
    const byte = seed[i % seed.length]!;
    // Map byte (0..255) to a value in [-1, 1)
    vec[i] = (byte / 255) * 2 - 1;
  }
  // L2 normalize
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  return vec;
}
