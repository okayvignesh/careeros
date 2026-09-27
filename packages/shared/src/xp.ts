// XP progression curve. Shared between api (compute overallLevel + progress) and
// web (render bar). One curve = level and bar can't drift.

const XP_EXP = 1.35;
const XP_BASE = 100;

/** XP required to reach the START of `level`. Level 1 = 100 XP, level 2 = 254, ... */
export function xpForLevel(level: number): number {
  return Math.round(XP_BASE * Math.pow(Math.max(1, level), XP_EXP));
}

/** Inverse: what level does `totalXp` place the user at? Clamped to [1, 100]. */
export function levelFromXp(totalXp: number): number {
  if (totalXp <= XP_BASE) return 1;
  const raw = Math.pow(totalXp / XP_BASE, 1 / XP_EXP);
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

/** Progress toward the next level, as a percentage in [0, 100]. */
export function levelProgressPct(totalXp: number): number {
  const level = levelFromXp(totalXp);
  if (level >= 100) return 100;
  const prev = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - prev;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((totalXp - prev) / span) * 100));
}

/** XP left to reach the next level; 0 once at level 100. */
export function xpToNextLevel(totalXp: number): number {
  const level = levelFromXp(totalXp);
  if (level >= 100) return 0;
  return Math.max(0, xpForLevel(level + 1) - totalXp);
}
