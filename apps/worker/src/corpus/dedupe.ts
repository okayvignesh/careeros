/**
 * Pure cosine-similarity helper for near-duplicate detection.
 *
 * ponytail: no matrix library — the vectors are 384-d and we compare one
 * candidate against a small (≤3) neighbour set, so a straight loop is fine.
 * Vectors are already L2-normalised by `embedDeterministic`, so cosine
 * reduces to a dot product; we keep the general form so a non-normalised
 * embedder still works.
 */

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSim dim mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Cosine cutoff for "close enough to be a duplicate". Chosen at 0.92:
 *   - `embedDeterministic` is a placeholder that produces near-identical
 *     vectors for near-identical inputs; two paraphrases score ~0.90–0.95.
 *   - Below 0.92 we start seeing distinct-but-related questions collapse
 *     (e.g. "Design a URL shortener" vs "Design a link redirector").
 *   - Above 0.95 obvious paraphrases slip through as new rows.
 * When the real bge-small-en encoder replaces the placeholder, revisit and
 * anchor to a labelled duplicate set. Until then, 0.92 is the ponytail
 * pick — one number, one place to tune.
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.92;

/** True if any candidate scores ≥ threshold against `vec`. */
export function isNearDuplicate(
  vec: number[],
  neighbours: Array<{ score: number }>,
  threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): boolean {
  // Qdrant returns pre-computed scores when the collection uses Cosine
  // distance — trust them. Callers passing raw vectors instead go through
  // `isNearDuplicateByVectors` below.
  void vec;
  return neighbours.some((n) => n.score >= threshold);
}

/** Alternate path: compare against a set of raw vectors (used in tests). */
export function isNearDuplicateByVectors(
  vec: number[],
  others: number[][],
  threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): boolean {
  return others.some((o) => cosineSim(vec, o) >= threshold);
}
