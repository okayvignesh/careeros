import type { Transition, Variants } from 'framer-motion';

/**
 * Shared motion tokens. Mirrors the `--dur-*` / `--ease*` custom properties in
 * tokens.css so JS and CSS motion stay in lockstep. Reduced-motion collapse is
 * handled by the media query in tokens.css.
 */

/** Durations in seconds, framer-motion's unit. */
export const dur = {
  micro: 0.12,
  fast: 0.2,
  standard: 0.3,
  deliberate: 0.4,
} as const;

/** Standard ease-out curve, matching `--ease-out` in tokens.css. */
export const ease = [0.16, 1, 0.3, 1] as const;

export const spring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 22,
  mass: 0.5,
};

export const tMicro: Transition = { duration: dur.micro, ease };
export const tFast: Transition = { duration: dur.fast, ease };
export const tStandard: Transition = { duration: dur.standard, ease };
export const tDeliberate: Transition = { duration: dur.deliberate, ease };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: tFast },
};

export const staggerList: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: tFast },
};

export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: tStandard },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: tMicro },
};

export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -2 },
  visible: { opacity: 1, scale: 1, y: 0, transition: tFast },
  exit: { opacity: 0, scale: 0.97, y: -2, transition: tMicro },
};
