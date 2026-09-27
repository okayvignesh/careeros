/**
 * Map a gap size (postings you're missing vs the market threshold) to a tone
 * bucket. Extracted so the badge render is trivial and the boundary logic is
 * unit-testable without JSX.
 *
 * Buckets picked to match the design plan: "quiet default", "warn amber",
 * "danger red" for the widest gaps. `met` is the zero-gap case.
 */

export type GapTone = 'met' | 'default' | 'warn' | 'danger';

export function gapTone(gap: number): GapTone {
  if (gap <= 0) return 'met';
  if (gap < 15) return 'default';
  if (gap < 30) return 'warn';
  return 'danger';
}

/** Label for the badge. Kept in one place so tests read cleanly. */
export function gapLabel(gap: number): string {
  if (gap <= 0) return 'Met';
  return `Gap ${gap}`;
}
