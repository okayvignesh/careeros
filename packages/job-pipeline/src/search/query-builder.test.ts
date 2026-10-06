import { describe, expect, it } from 'vitest';
import {
  ATS_SITE_HINTS,
  PLATFORM_SITE_HINTS,
  SITE_HINTS,
  buildCandidateSearchQueries,
  containsBannedPlatformTerm,
  type CandidateSearchProfile,
} from './query-builder';

function profile(over: Partial<CandidateSearchProfile> = {}): CandidateSearchProfile {
  return {
    targetRoles: ['Backend Engineer'],
    locations: ['Berlin'],
    remoteOnly: false,
    seniority: ['senior'],
    mustHaveSkills: ['TypeScript', 'Postgres'],
    dealbreakerSkills: ['PHP'],
    candidateSkills: ['Node.js', 'AWS'],
    ...over,
  };
}

describe('buildCandidateSearchQueries', () => {
  it('derives a role + location + skills query from a candidate profile', () => {
    const queries = buildCandidateSearchQueries(profile());
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q).toContain('senior');
    expect(q).toContain('Backend Engineer');
    expect(q).toContain('in Berlin');
    expect(q).toContain('TypeScript');
    expect(q).toContain('Postgres');
    expect(q).toContain('-"PHP"');
  });

  it('biases discovery toward permitted ATS boards via site: hints', () => {
    const [q] = buildCandidateSearchQueries(profile(), {
      siteHints: ATS_SITE_HINTS,
      siteHintsPerQuery: 2,
    });
    expect(q).toContain(`site:${ATS_SITE_HINTS[0]}`);
    expect(q).toContain(`site:${ATS_SITE_HINTS[1]}`);
    expect(q).not.toContain(`site:${ATS_SITE_HINTS[2]}`);
  });

  it('includes the now-permitted platforms in the default site hints', () => {
    expect(SITE_HINTS).toEqual(expect.arrayContaining([...ATS_SITE_HINTS, ...PLATFORM_SITE_HINTS]));
    expect(SITE_HINTS.some((h) => ATS_SITE_HINTS.includes(h))).toBe(true);
    expect(SITE_HINTS.some((h) => PLATFORM_SITE_HINTS.includes(h))).toBe(true);
  });

  it('round-robins site hints across queries so platform hosts surface', () => {
    const queries = buildCandidateSearchQueries(
      profile({
        targetRoles: ['A', 'B', 'C', 'D'],
        locations: ['X'],
        seniority: [],
        mustHaveSkills: [],
        candidateSkills: [],
        dealbreakerSkills: [],
      }),
      { maxRoles: 4, maxLocationsPerRole: 1, maxQueries: 4, siteHintsPerQuery: 3 },
    );
    expect(queries).toHaveLength(4);

    // Each query carries at most the per-query cap and they differ.
    const counts = queries.map((q) => (q.match(/site:/g) ?? []).length);
    expect(counts.every((n) => n === 3)).toBe(true);

    // First window includes a platform (interleaved), later windows rotate on.
    expect(queries[0]).toContain('site:linkedin.com/jobs');
    expect(queries[1]).toContain('site:indeed.com');
    expect(queries[2]).toContain('site:glassdoor.com');
    // The union across the first two queries covers distinct hints.
    expect(queries[0]).not.toEqual(queries[1]);
  });

  it('rotates the skill window across queries so coverage broadens', () => {
    const queries = buildCandidateSearchQueries(
      profile({
        targetRoles: ['Backend Engineer', 'Platform Engineer', 'SRE'],
        candidateSkills: ['Go', 'Kubernetes', 'Terraform', 'Docker', 'Redis', 'Kafka'],
        mustHaveSkills: [],
      }),
      { maxSkillsPerQuery: 2, maxQueries: 3, siteHints: [] },
    );
    expect(queries).toHaveLength(3);
    expect(queries[1]).not.toEqual(queries[0]);
    expect(queries[2]).not.toEqual(queries[1]);
  });

  it('is bounded by maxQueries regardless of role x location fan-out', () => {
    const queries = buildCandidateSearchQueries(
      profile({
        targetRoles: ['A', 'B', 'C', 'D', 'E'],
        locations: ['X', 'Y', 'Z'],
      }),
      { maxQueries: 4, maxRoles: 5, maxLocationsPerRole: 3 },
    );
    expect(queries).toHaveLength(4);
  });

  it('returns [] when there is no target role (no blind crawling)', () => {
    expect(buildCandidateSearchQueries(profile({ targetRoles: [] }))).toEqual([]);
    expect(buildCandidateSearchQueries(profile({ targetRoles: ['   '] }))).toEqual([]);
  });

  it('keeps platform names in queries now that Firecrawl may target them', () => {
    const queries = buildCandidateSearchQueries(
      profile({
        targetRoles: ['LinkedIn Recruiter', 'Backend Engineer'],
        locations: ['Indeed'],
        mustHaveSkills: ['Glassdoor', 'Naukri', 'Rust'],
        dealbreakerSkills: [],
      }),
      { siteHints: [] },
    );
    const all = queries.join(' ').toLowerCase();
    // The deprecated filter no longer drops these terms.
    for (const platform of ['linkedin', 'indeed', 'glassdoor', 'naukri']) {
      expect(all).toContain(platform);
    }
    expect(queries[0]).toContain('Rust');
    for (const q of queries) expect(containsBannedPlatformTerm(q)).toBe(false);
  });

  it('marks remote-only candidates as remote and omits an explicit location', () => {
    const [q] = buildCandidateSearchQueries(
      profile({ locations: [], remoteOnly: true, siteHints: [] }),
    );
    expect(q).toContain('remote');
    expect(q).not.toContain('in ');
  });
});
