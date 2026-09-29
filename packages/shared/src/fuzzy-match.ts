// E.7: fuzzy match helpers.
//
// Two levels of similarity:
//   1. `normalizeCompany`, `normalizeRole` - lowercase + strip legal
//      suffixes (Inc, Ltd, GmbH, ...) + drop punctuation. Two strings
//      normalize to the same output iff they are the same company/role
//      modulo cosmetic drift.
//   2. `similarityRatio(a, b)` - Levenshtein-derived ratio in [0, 1].
//      Sub-quadratic in code but O(len_a * len_b) in complexity; the
//      strings involved (company name + role title) are tiny.
//
// Confidence bands the caller uses (matches phase-5:83-87):
//   1.00  both fields normalize to an equal match (exact)
//   0.80  string similarity of both fields >= 0.85
//   0.50  single-field match
//   0.00  no match
//
// The scoring function `scoreEmailAgainstApplication` is the single
// contract E.7 downstream consumes. It never returns 0-scored matches
// (returns null) so the caller can early-exit.

const COMPANY_LEGAL_SUFFIXES = [
  'inc',
  'inc.',
  'incorporated',
  'llc',
  'l.l.c.',
  'ltd',
  'ltd.',
  'limited',
  'gmbh',
  'ag',
  'sa',
  's.a.',
  'plc',
  'co',
  'co.',
  'company',
  'corp',
  'corp.',
  'corporation',
  'pvt',
  'pvt.',
  'private',
  'llp',
  'l.l.p.',
];

const ROLE_STOPWORDS = new Set([
  'senior',
  'sr',
  'sr.',
  'staff',
  'principal',
  'lead',
  'junior',
  'jr',
  'jr.',
  'associate',
  'entry',
  'level',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'the',
  'a',
  'an',
]);

function stripPunct(s: string): string {
  return s.replace(/[.,;:!?()[\]{}"'`/\\&+-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeCompany(input: string): string {
  const s = stripPunct(String(input ?? '').toLowerCase());
  const tokens = s.split(' ').filter((t) => t.length > 0);
  while (tokens.length > 0 && COMPANY_LEGAL_SUFFIXES.includes(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

export function normalizeRole(input: string): string {
  const s = stripPunct(String(input ?? '').toLowerCase());
  const tokens = s
    .split(' ')
    .filter((t) => t.length > 0)
    .filter((t) => !ROLE_STOPWORDS.has(t));
  return tokens.join(' ');
}

/** Levenshtein distance (classic DP table; sufficient for company/role strings). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,       // deletion
        curr[j - 1]! + 1,   // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Similarity ratio in [0, 1]. 1 = identical. */
export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

export interface EmailFields {
  company: string | null;
  role: string | null;
}

export interface ApplicationFields {
  id: string;
  company: string;
  role: string;
}

export type MatchMethod = 'exact-both' | 'similar-both' | 'company-only' | 'role-only';

export interface MatchScore {
  applicationId: string;
  confidence: number;
  method: MatchMethod;
}

const SIMILARITY_THRESHOLD = 0.85;

/**
 * Score a parsed email against ONE application. Returns null when nothing
 * on either field matches. Bands documented at the top of this file.
 */
export function scoreEmailAgainstApplication(
  email: EmailFields,
  app: ApplicationFields,
): MatchScore | null {
  const eCo = email.company ? normalizeCompany(email.company) : '';
  const eRl = email.role ? normalizeRole(email.role) : '';
  const aCo = normalizeCompany(app.company);
  const aRl = normalizeRole(app.role);

  const coExact = eCo && aCo && eCo === aCo;
  const rlExact = eRl && aRl && eRl === aRl;
  if (coExact && rlExact) {
    return { applicationId: app.id, confidence: 1, method: 'exact-both' };
  }

  const coSim = eCo && aCo ? similarityRatio(eCo, aCo) : 0;
  const rlSim = eRl && aRl ? similarityRatio(eRl, aRl) : 0;
  if (coSim >= SIMILARITY_THRESHOLD && rlSim >= SIMILARITY_THRESHOLD) {
    return { applicationId: app.id, confidence: 0.8, method: 'similar-both' };
  }

  if (coExact || coSim >= SIMILARITY_THRESHOLD) {
    return { applicationId: app.id, confidence: 0.5, method: 'company-only' };
  }
  if (rlExact || rlSim >= SIMILARITY_THRESHOLD) {
    return { applicationId: app.id, confidence: 0.5, method: 'role-only' };
  }

  return null;
}

/**
 * Given an email + a set of candidate applications, pick the best match
 * (highest confidence; ties broken by exact company match). Returns null
 * when no candidate scores anything.
 */
export function bestMatch(
  email: EmailFields,
  apps: readonly ApplicationFields[],
): MatchScore | null {
  let best: MatchScore | null = null;
  for (const app of apps) {
    const score = scoreEmailAgainstApplication(email, app);
    if (!score) continue;
    if (
      !best ||
      score.confidence > best.confidence ||
      (score.confidence === best.confidence && score.method === 'exact-both')
    ) {
      best = score;
    }
  }
  return best;
}

/**
 * Threshold above which the caller should auto-link (no user review needed).
 * Matches phase-5:83-87 spec (>= 0.85).
 */
export const AUTO_LINK_THRESHOLD = 0.85;
