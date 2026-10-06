// Pure rules that turn resume facts + the candidate skill graph into a first
// draft of `user_job_preferences`. Kept side-effect free so the merge rules are
// unit-testable without Prisma.
import type { JobPreferencesInput } from '@careeros/shared';

export type SeniorityBand = JobPreferencesInput['seniority'][number];

export const DERIVE_ROLES_CAP = 5;
export const DERIVE_LOCATIONS_CAP = 5;
export const DERIVE_SKILLS_CAP = 10;

const SENIORITY_ORDER: readonly SeniorityBand[] = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'principal',
  'manager',
];

// Rank matches packages/job-pipeline classify-seniority (lead === staff rank).
const SENIORITY_RULES: ReadonlyArray<{ re: RegExp; band: SeniorityBand }> = [
  { re: /\bprincipal\b/i, band: 'principal' },
  { re: /\bstaff\b/i, band: 'staff' },
  { re: /\b(lead|head)\b/i, band: 'staff' },
  { re: /\b(senior|sr\.?|snr\.?)\b/i, band: 'senior' },
  { re: /\b(manager|director|vice\s+president|vp|chief)\b/i, band: 'manager' },
];

/** Trim, drop blanks, de-dupe case-insensitively, keep first spelling, cap. */
export function dedupeCap(values: readonly string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/** Employment titles first, then the headline as a fallback role, capped. */
export function inferTargetRoles(
  employmentTitles: readonly string[],
  headline: string,
): string[] {
  const headlineText = headline.trim();
  return dedupeCap(
    [...employmentTitles, ...(headlineText ? [headlineText] : [])],
    DERIVE_ROLES_CAP,
  );
}

/** "Bengaluru, India" → ["Bengaluru", "India"]; good enough for prefs the user edits. */
export function deriveLocations(locationText: string): string[] {
  return dedupeCap(locationText.split(/[,/|]|\s+-\s+/), DERIVE_LOCATIONS_CAP);
}

/** Collect seniority bands implied by the candidate's own titles. */
export function inferSeniority(titles: readonly string[]): SeniorityBand[] {
  const found = new Set<SeniorityBand>();
  for (const title of titles) {
    if (!title) continue;
    for (const rule of SENIORITY_RULES) {
      if (rule.re.test(title)) found.add(rule.band);
    }
  }
  return SENIORITY_ORDER.filter((band) => found.has(band));
}

/**
 * Field-level merge. With `onlyFillEmpty`, a non-empty current value always
 * wins. Without it, a non-empty derived value wins. An empty derived value
 * never clears existing user data.
 */
export function pickFill<T>(current: readonly T[], derived: readonly T[], onlyFillEmpty: boolean): T[] {
  if (onlyFillEmpty && current.length > 0) return [...current];
  return derived.length > 0 ? [...derived] : [...current];
}
