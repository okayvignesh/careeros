/**
 * Dark-first palette mirrored from `packages/ui/src/tokens.css`.
 *
 * The UI package targets React DOM + Tailwind, so its primitives cannot be
 * imported into React Native. The design tokens, however, are just values —
 * this file is the single place the mobile app restates them. Keep it in step
 * with tokens.css; there is no cross-build token export today.
 */
const hsl = (h: number, s: number, l: number): string => `hsl(${h}, ${s}%, ${l}%)`;

export const colors = {
  bg: hsl(235, 24, 4),
  bgElev1: hsl(235, 18, 6.5),
  bgElev2: hsl(235, 16, 9),
  bgHover: hsl(235, 16, 12),

  fg: hsl(235, 20, 97),
  fgMuted: hsl(235, 8, 68),
  fgSubtle: hsl(235, 8, 46),
  fgFaint: hsl(235, 8, 30),

  border: hsl(235, 12, 13),
  borderStrong: hsl(235, 12, 19),

  accent: hsl(239, 84, 66),
  accentFg: hsl(0, 0, 100),
  accentMuted: hsl(239, 40, 26),

  success: hsl(155, 50, 55),
  warn: hsl(42, 88, 60),
  danger: hsl(358, 68, 60),
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

export function approvalStateColor(state: string): string {
  switch (state) {
    case 'pending':
      return colors.warn;
    case 'approved':
    case 'sent':
      return colors.success;
    case 'failed':
      return colors.danger;
    case 'cancelled':
      return colors.fgSubtle;
    default:
      return colors.fgMuted;
  }
}
