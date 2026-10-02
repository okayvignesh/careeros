/**
 * F7 candidate-targeted Firecrawl query builder.
 *
 * Turns a candidate's career goals (target roles, locations, remote-only,
 * seniority), job preferences (must-have / dealbreaker skills) and demonstrated
 * skills into a bounded set of web-search queries. The queries bias discovery
 * toward public ATS/career boards (U6-permitted) and never mention a banned
 * platform (LinkedIn/Indeed/Naukri/Glassdoor, AGENTS.md §3.4).
 *
 * Pure + injectable: no network, no clock. The worker/service feeds the strings
 * to `FirecrawlClient.search()`.
 */

/**
 * Public ATS/career-board hosts permitted by owner decision U6. Used as
 * `site:` hints so discovery lands on employer boards rather than aggregators.
 * Kept as hostnames (no scheme) because search engines expect `site:host`.
 */
export const ATS_SITE_HINTS: readonly string[] = [
  'jobs.lever.co',
  'boards.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
  'apply.workable.com',
  'myworkdayjobs.com',
];

/** Banned-platform tokens. A query containing any of these is dropped. */
export const BANNED_PLATFORM_TERMS: readonly string[] = [
  'linkedin',
  'indeed',
  'naukri',
  'glassdoor',
];

export interface CandidateSearchProfile {
  /** Role titles the candidate is targeting, e.g. ["Backend Engineer"]. */
  targetRoles: string[];
  /** Locations, e.g. ["Bengaluru", "Remote"]. Empty + remoteOnly → "remote". */
  locations: string[];
  /** When true, append "remote" so the query skews remote-friendly. */
  remoteOnly: boolean;
  /** Seniority ladder values from career goals, e.g. ["senior"]. */
  seniority: string[];
  /** Must-have skill terms (human-readable names, not ESCO ids). */
  mustHaveSkills: string[];
  /** Dealbreaker skill terms — emitted as negative qualifiers (`-term`). */
  dealbreakerSkills: string[];
  /** Demonstrated skill terms resolved from the catalogue. */
  candidateSkills: string[];
}

export interface BuildCandidateSearchQueriesOptions {
  /** Hard ceiling on emitted queries. Default 8. */
  maxQueries?: number;
  /** Skills woven into a single query. Default 4. */
  maxSkillsPerQuery?: number;
  /** Max roles expanded. Default 4. */
  maxRoles?: number;
  /** Max locations expanded per role. Default 2. */
  maxLocationsPerRole?: number;
  /** Max dealbreaker negatives attached to one query. Default 4. */
  maxDealbreakersPerQuery?: number;
  /** Site hints; defaults to {@link ATS_SITE_HINTS}. Pass [] to disable. */
  siteHints?: readonly string[];
  /** How many site hints per query. Default 3. */
  siteHintsPerQuery?: number;
}

const DEFAULTS = {
  maxQueries: 8,
  maxSkillsPerQuery: 4,
  maxRoles: 4,
  maxLocationsPerRole: 2,
  maxDealbreakersPerQuery: 4,
  siteHintsPerQuery: 3,
} as const;

/**
 * Build bounded Firecrawl search queries from a candidate profile. Returns an
 * empty array when there is no role to search for (caller should no-op rather
 * than issue a blind crawl). Deterministic given the same input.
 */
export function buildCandidateSearchQueries(
  profile: CandidateSearchProfile,
  options: BuildCandidateSearchQueriesOptions = {},
): string[] {
  const maxQueries = options.maxQueries ?? DEFAULTS.maxQueries;
  const maxSkillsPerQuery = options.maxSkillsPerQuery ?? DEFAULTS.maxSkillsPerQuery;
  const maxRoles = options.maxRoles ?? DEFAULTS.maxRoles;
  const maxLocationsPerRole = options.maxLocationsPerRole ?? DEFAULTS.maxLocationsPerRole;
  const maxDealbreakersPerQuery =
    options.maxDealbreakersPerQuery ?? DEFAULTS.maxDealbreakersPerQuery;
  const siteHints = (options.siteHints ?? ATS_SITE_HINTS).slice(
    0,
    options.siteHintsPerQuery ?? DEFAULTS.siteHintsPerQuery,
  );

  const roles = dedupeTerms(profile.targetRoles).slice(0, maxRoles);
  if (roles.length === 0) return [];

  const seniority = dedupeTerms(profile.seniority)[0] ?? '';
  const skillsPool = dedupeTerms([...profile.mustHaveSkills, ...profile.candidateSkills]);
  const dealbreakers = dedupeTerms(profile.dealbreakerSkills).slice(
    0,
    maxDealbreakersPerQuery,
  );

  const rawLocations = dedupeTerms(profile.locations).slice(0, maxLocationsPerRole);
  const locations: Array<string | null> =
    rawLocations.length > 0 ? rawLocations : profile.remoteOnly ? [null] : [null];

  const queries: string[] = [];
  const seen = new Set<string>();
  let skillCursor = 0;

  for (const role of roles) {
    for (const location of locations) {
      if (queries.length >= maxQueries) return queries;
      // Rotate the skill window so consecutive queries cover different skills
      // instead of repeating the same top-N combination.
      const skills: string[] = [];
      for (let i = 0; i < maxSkillsPerQuery && skillsPool.length > 0; i++) {
        skills.push(skillsPool[(skillCursor + i) % skillsPool.length]!);
      }
      skillCursor += maxSkillsPerQuery;

      const parts: string[] = [];
      if (seniority) parts.push(seniority);
      parts.push(role);
      parts.push('jobs');
      if (location) parts.push(`in ${location}`);
      else if (profile.remoteOnly) parts.push('remote');
      else parts.push('remote OR onsite');
      parts.push(...skills);
      if (siteHints.length > 0) {
        parts.push(`(${siteHints.map((h) => `site:${h}`).join(' OR ')})`);
      }
      for (const d of dealbreakers) parts.push(`-"${d}"`);

      const query = normalizeWhitespace(parts.join(' '));
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      if (containsBannedPlatformTerm(query)) continue;
      seen.add(key);
      queries.push(query);
    }
  }

  return queries;
}

/** True when a term/query references a banned platform. Also true on empty. */
export function containsBannedPlatformTerm(value: string): boolean {
  const needle = value.toLowerCase();
  return BANNED_PLATFORM_TERMS.some((term) => needle.includes(term));
}

function dedupeTerms(terms: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const trimmed = normalizeWhitespace(raw);
    if (!trimmed) continue;
    if (containsBannedPlatformTerm(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
