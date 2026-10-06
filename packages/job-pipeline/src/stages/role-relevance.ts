/**
 * C-P?: target-role relevance.
 *
 * The base relevance stage filters on remote / skills / blacklist / staleness.
 * It never looked at the candidate's target roles, so an install targeting
 * "Backend Engineer" still saw "Account Executive" and finance roles. This adds
 * a fuzzy title↔role match: a job title is kept when it shares a meaningful
 * token with any target role (seniority words ignored, common role synonyms
 * expanded). Empty target roles ⇒ everything matches (no-op).
 *
 * Deliberately generous: "similar is fine"; the goal is to drop clearly
 * unrelated functions, not to be an exact classifier.
 */

const SENIORITY_STOPWORDS = new Set([
  'senior',
  'sr',
  'staff',
  'lead',
  'principal',
  'junior',
  'jr',
  'mid',
  'midlevel',
  'head',
  'vp',
  'director',
  'associate',
  'chief',
  'intern',
  'internship',
  'entry',
  'i',
  'ii',
  'iii',
]);

/** Token → equivalent tokens that should also count as a match. */
const SYNONYMS: Record<string, readonly string[]> = {
  sre: ['sre', 'reliability'],
  devops: ['devops', 'platform', 'infrastructure', 'reliability'],
  ml: ['ml', 'machine', 'learning'],
  ai: ['ai', 'machine', 'learning'],
  backend: ['backend', 'back-end', 'server', 'api'],
  back: ['backend', 'back-end'],
  frontend: ['frontend', 'front-end', 'ui', 'web'],
  front: ['frontend', 'front-end'],
  fullstack: ['fullstack', 'full-stack'],
  mobile: ['mobile', 'ios', 'android'],
  data: ['data', 'analytics', 'analyst'],
  qa: ['qa', 'quality', 'test'],
  security: ['security', 'appsec'],
  cloud: ['cloud', 'platform'],
  product: ['product'],
  engineer: ['engineer', 'engineering'],
  developer: ['developer', 'engineer', 'engineering'],
  designer: ['designer', 'design'],
  analyst: ['analyst', 'analytics'],
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= 2 && !SENIORITY_STOPWORDS.has(t));
}

/** Expanded token set for a set of target roles. */
export function roleTokens(roles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const role of roles) {
    for (const token of tokens(role)) {
      for (const syn of SYNONYMS[token] ?? [token]) out.add(syn);
    }
  }
  return out;
}

/**
 * True when `title` shares a token with any target role (substring match, so
 * "Engineering" matches the "engineer" token). Empty roles ⇒ true.
 */
export function titleMatchesRoles(title: string, roles: readonly string[]): boolean {
  const wanted = roleTokens(roles);
  if (wanted.size === 0) return true;
  const haystack = title.toLowerCase();
  for (const token of wanted) {
    if (haystack.includes(token)) return true;
  }
  return false;
}
