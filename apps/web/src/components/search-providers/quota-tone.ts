/**
 * Search-provider quota bar tone. The bar doubles as the provider status
 * indicator per the design plan for screen 56 ("quota bars doubling as
 * status"). Extracted from the render so the thresholds are visible +
 * testable.
 */

export type QuotaTone = 'default' | 'warn' | 'danger';

export function quotaTone(used: number, quota: number): QuotaTone {
  if (quota <= 0) return 'default';
  const share = used / quota;
  if (share >= 0.9) return 'danger';
  if (share >= 0.7) return 'warn';
  return 'default';
}

export function quotaShare(used: number, quota: number): number {
  if (quota <= 0) return 0;
  return Math.max(0, Math.min(1, used / quota));
}
