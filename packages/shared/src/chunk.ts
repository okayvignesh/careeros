// Sliding-window chunker. Splits text into overlapping chunks so semantic queries
// hit at least one chunk that fully contains the answer.
//
// Character-based (not token-based): token counts vary per model and aren't worth
// pulling in a tokeniser for MVP. Blueprint calls for 512-token / 64-token overlap;
// at English averaging ~4 chars/token that's ~2048 chars / 256 overlap.

export interface Chunk {
  idx: number;
  text: string;
  /** UTF-16 code-unit offset in the original source string. Not the byte offset. */
  start: number;
  end: number;
}

const DEFAULT_SIZE = 2048;
const DEFAULT_OVERLAP = 256;

export function chunkText(
  text: string,
  {
    size = DEFAULT_SIZE,
    overlap = DEFAULT_OVERLAP,
  }: { size?: number; overlap?: number } = {},
): Chunk[] {
  if (size <= 0) throw new Error('chunk size must be positive');
  if (overlap < 0 || overlap >= size) throw new Error('overlap must be in [0, size)');
  const chunks: Chunk[] = [];
  const trimmed = text ?? '';
  if (trimmed.length === 0) return chunks;

  const stride = size - overlap;
  let idx = 0;
  for (let start = 0; start < trimmed.length; start += stride) {
    const end = Math.min(start + size, trimmed.length);
    chunks.push({ idx, text: trimmed.slice(start, end), start, end });
    idx++;
    if (end === trimmed.length) break;
  }
  return chunks;
}
