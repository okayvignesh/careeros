// C-P1.2b: Hard-coded role → canonical-skill mapping used by the
// learning-priority orchestrator to translate the user's targetRoles
// (free-form strings like "Backend Engineer", "SRE", "Data Scientist")
// into the ESCO skill IDs that count as "role-relevant" for the priority
// formula (see learning-priority.ts).
//
// Every skill ID below matches a row seeded by
// apps/api/src/seed/esco.data.json -- if you add a family, verify the IDs
// exist in that seed or the priority row will silently vanish (missing skills
// contribute 0 demand and 0 proficiency, so they'd rank last regardless).
//
// Ponytail: this is a lookup table, not a taxonomy. 12 families with 5-10
// skills each is enough surface for the walking-skeleton; the follow-up is
// to derive this from ESCO occupation → skill relations once we ingest them.

/** All the family keys, so callers can iterate + so `resolveRoleSkills`
 *  never partially matches (e.g. "front" ≠ "frontend"). */
export type RoleFamily =
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'mobile'
  | 'devops'
  | 'sre'
  | 'platform'
  | 'data-engineer'
  | 'data-scientist'
  | 'ml-engineer'
  | 'security'
  | 'engineering-manager';

/**
 * Aliases the user is likely to type in `targetRoles`. All lowercased +
 * whitespace-normalised at match time; keep entries lowercase here.
 * Order in each array is irrelevant.
 */
const ROLE_ALIASES: Record<RoleFamily, string[]> = {
  backend: ['backend', 'backend engineer', 'backend developer', 'server-side', 'api engineer'],
  frontend: ['frontend', 'frontend engineer', 'frontend developer', 'ui engineer', 'web developer'],
  fullstack: ['fullstack', 'full stack', 'full-stack', 'fullstack engineer', 'full stack engineer'],
  mobile: ['mobile', 'mobile engineer', 'ios engineer', 'android engineer', 'mobile developer'],
  devops: ['devops', 'devops engineer', 'infrastructure engineer', 'cloud engineer'],
  sre: ['sre', 'site reliability engineer', 'reliability engineer', 'production engineer'],
  platform: ['platform', 'platform engineer', 'developer experience', 'dx engineer'],
  'data-engineer': ['data engineer', 'analytics engineer', 'etl engineer'],
  'data-scientist': ['data scientist', 'ml scientist', 'research scientist'],
  'ml-engineer': ['ml engineer', 'machine learning engineer', 'ai engineer', 'llm engineer'],
  security: ['security', 'security engineer', 'application security', 'appsec engineer'],
  'engineering-manager': ['engineering manager', 'em', 'tech lead manager', 'director of engineering'],
};

/**
 * Canonical skill IDs per role family. Every ID here MUST exist in
 * apps/api/src/seed/esco.data.json.
 */
const ROLE_SKILLS: Record<RoleFamily, readonly string[]> = {
  backend: ['nodejs', 'python', 'go', 'java', 'postgres', 'redis', 'rest-api', 'graphql', 'docker', 'system-design'],
  frontend: ['ts', 'react', 'nextjs', 'css', 'tailwind', 'html', 'vite', 'accessibility', 'webpack'],
  fullstack: ['ts', 'react', 'nextjs', 'nodejs', 'postgres', 'rest-api', 'docker', 'system-design'],
  mobile: ['swift', 'swiftui', 'kotlin', 'android', 'react-native', 'flutter', 'ios'],
  devops: ['docker', 'kubernetes', 'terraform', 'aws', 'ansible', 'ci-cd', 'github-actions', 'helm', 'bash'],
  sre: ['kubernetes', 'prometheus', 'grafana', 'terraform', 'aws', 'observability', 'opentelemetry', 'chaos-engineering', 'sre'],
  platform: ['kubernetes', 'terraform', 'aws', 'docker', 'ci-cd', 'argocd', 'helm', 'observability'],
  'data-engineer': ['python', 'sql', 'airflow', 'dbt', 'spark', 'snowflake', 'bigquery', 'kafka'],
  'data-scientist': ['python', 'pandas', 'numpy', 'scikit-learn', 'pytorch', 'sql', 'deep-learning', 'r'],
  'ml-engineer': ['python', 'pytorch', 'tensorflow', 'huggingface', 'rag', 'vector-db', 'openai-api', 'mlops'],
  security: ['security', 'oauth', 'webauthn', 'vault', 'threat-modeling', 'appsec'],
  'engineering-manager': ['system-design', 'code-review', 'agile', 'documentation', 'engineering-manager', 'tech-lead'],
};

/** Count of families exposed; used by tests + report. */
export const ROLE_FAMILY_COUNT = (Object.keys(ROLE_SKILLS) as RoleFamily[]).length;

/**
 * Normalise a user-entered role string ("Senior Backend Engineer") into a
 * `RoleFamily` key, or null if it doesn't match a known family. Matching is
 * substring-based on the alias table so seniority prefixes ("Senior",
 * "Staff", "Junior") don't blow the mapping up.
 */
export function matchRoleFamily(role: string): RoleFamily | null {
  const needle = role.trim().toLowerCase();
  if (!needle) return null;
  // Prefer the longest matching alias so "site reliability engineer" beats
  // an alias like "engineer" if we ever add one.
  let best: { family: RoleFamily; len: number } | null = null;
  for (const family of Object.keys(ROLE_ALIASES) as RoleFamily[]) {
    for (const alias of ROLE_ALIASES[family]) {
      if (needle.includes(alias)) {
        if (!best || alias.length > best.len) {
          best = { family, len: alias.length };
        }
      }
    }
  }
  return best?.family ?? null;
}

/**
 * Resolve a list of user-entered target roles to the union of their
 * canonical skill IDs. Unknown roles are dropped silently; callers can
 * use `matchRoleFamily` first if they need to surface unmatched roles.
 */
export function resolveRoleSkills(roles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const r of roles) {
    const family = matchRoleFamily(r);
    if (!family) continue;
    for (const s of ROLE_SKILLS[family]) out.add(s);
  }
  return out;
}

/** Test-only accessor so the map can be inspected without leaking mutability. */
export function skillsForFamily(family: RoleFamily): readonly string[] {
  return ROLE_SKILLS[family];
}
