import { SETUP_STEPS } from '@careeros/shared/constants';

export const TOTAL_STEPS = SETUP_STEPS.length;

export function stepAt(index: number): (typeof SETUP_STEPS)[number] {
  const step = SETUP_STEPS[index];
  if (!step) throw new Error(`No setup step at index ${index}`);
  return step;
}

export function nextHref(currentSlug: string): string | null {
  const idx = SETUP_STEPS.findIndex((s) => s.slug === currentSlug);
  if (idx === -1 || idx === SETUP_STEPS.length - 1) return null;
  return `/setup/${SETUP_STEPS[idx + 1]!.slug}`;
}

export function prevHref(currentSlug: string): string | null {
  const idx = SETUP_STEPS.findIndex((s) => s.slug === currentSlug);
  if (idx <= 0) return null;
  return `/setup/${SETUP_STEPS[idx - 1]!.slug}`;
}
