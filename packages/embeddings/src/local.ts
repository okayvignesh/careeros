import { createHash } from 'node:crypto';

/**
 * Deterministic placeholder embedding for the wizard's round-trip test.
 * Produces a stable unit-normalized 384-d vector from the input string.
 * Real semantic embeddings (bge-small-en via @xenova/transformers) land in P1.
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
