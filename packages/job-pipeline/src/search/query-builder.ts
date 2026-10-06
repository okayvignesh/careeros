/**
 * F7 candidate-targeted Firecrawl query builder.
 *
 * Turns a candidate's career goals (target roles, locations, remote-only,
 * seniority), job preferences (must-have / dealbreaker skills) and demonstrated
 * skills into a bounded set of web-search queries. The queries bias discovery
 * toward public ATS/career boards and the major job platforms now permitted via
 * Firecrawl (owner decision 2026-10-06: LinkedIn/Indeed/Naukri/Glassdoor may be
 * discovered + scraped through Firecrawl only).
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

/**
 * Major-platform hosts now permitted via Firecrawl (owner decision 2026-10-06).
 * Discovery + scrape of their pages is allowed through Firecrawl; direct
 * first-party scraping and non-Firecrawl third-party scrapers stay banned.
 */
export const PLATFORM_SITE_HINTS: readonly string[] = [
  'linkedin.com/jobs',
  'indeed.com',
  'naukri.com',
  'glassdoor.com',
];

/**
 * Default `site:` hints: ATS boards interleaved with the permitted platforms.
 * Interleaving (rather than appending) means a low per-query cap still surfaces
 * platform hits in the first emitted queries instead of only after the ATS
 * hosts run out.
 */
export const SITE_HINTS: readonly string[] = interleave(ATS_SITE_HINTS, PLATFORM_SITE_HINTS);

/**
 * @deprecated Owner decision 2026-10-06 permits LinkedIn/Indeed/Naukri/Glassdoor
 * via Firecrawl, so these tokens no longer filter anything. Kept exported for
 * import compatibility; see {@link containsBannedPlatformTerm}.
 */
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
  /** Site hints; defaults to {@link SITE_HINTS}. Pass [] to disable. */
  siteHints?: readonly string[];
  /** How many site hints per query, round-robined across queries. Default 3. */
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
  const siteHintPool = options.siteHints ?? SITE_HINTS;
  const siteHintsPerQuery = options.siteHintsPerQuery ?? DEFAULTS.siteHintsPerQuery;

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
      const siteHints = pickSiteHints(siteHintPool, siteHintsPerQuery, queries.length);
      if (siteHints.length > 0) {
        parts.push(`(${siteHints.map((h) => `site:${h}`).join(' OR ')})`);
      }
      for (const d of dealbreakers) parts.push(`-"${d}"`);

      const query = normalizeWhitespace(parts.join(' '));
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push(query);
    }
  }

  return queries;
}

/**
 * @deprecated No-op since owner decision 2026-10-06 (LinkedIn/Indeed/Naukri/
 * Glassdoor are permitted via Firecrawl). Always returns `false`; kept so
 * existing importers keep compiling. Use {@link BANNED_PLATFORM_TERMS} only as
 * a historical record.
 */
export function containsBannedPlatformTerm(_value: string): boolean {
  return false;
}

function dedupeTerms(terms: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const trimmed = normalizeWhitespace(raw);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Round-robin `perQuery` site hints starting at `index`, wrapping the pool and
 * never exceeding `perQuery` (or the pool size). Bounded by design so a query
 * never balloons with dozens of `site:` clauses.
 */
function pickSiteHints(
  pool: readonly string[],
  perQuery: number,
  index: number,
): string[] {
  if (pool.length === 0 || perQuery <= 0) return [];
  const count = Math.min(perQuery, pool.length);
  const start = (index * perQuery) % pool.length;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const hint = pool[(start + i) % pool.length]!;
    if (seen.has(hint)) continue;
    seen.add(hint);
    out.push(hint);
  }
  return out;
}

/** Alternate two lists: a[0], b[0], a[1], b[1], … then any remainder. */
function interleave(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
