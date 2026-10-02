import { describe, expect, it } from 'vitest';
import {
  ATS_SITE_HINTS,
  BANNED_PLATFORM_TERMS,
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
    const [q] = buildCandidateSearchQueries(profile(), { siteHintsPerQuery: 2 });
    expect(q).toContain(`site:${ATS_SITE_HINTS[0]}`);
    expect(q).toContain(`site:${ATS_SITE_HINTS[1]}`);
    expect(q).not.toContain(`site:${ATS_SITE_HINTS[2]}`);
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

  it('never emits a banned platform, even if the profile names one', () => {
    const queries = buildCandidateSearchQueries(
      profile({
        targetRoles: ['LinkedIn Recruiter', 'Backend Engineer'],
        locations: ['Indeed'],
        mustHaveSkills: ['Glassdoor', 'Naukri', 'Rust'],
        dealbreakerSkills: [],
      }),
    );
    for (const q of queries) {
      expect(containsBannedPlatformTerm(q)).toBe(false);
      for (const banned of BANNED_PLATFORM_TERMS) {
        expect(q.toLowerCase()).not.toContain(banned);
      }
    }
    // The clean skill still survives; only the poisoned terms are dropped.
    expect(queries[0]).toContain('Rust');
  });

  it('marks remote-only candidates as remote and omits an explicit location', () => {
    const [q] = buildCandidateSearchQueries(
      profile({ locations: [], remoteOnly: true, siteHints: [] }),
    );
    expect(q).toContain('remote');
    expect(q).not.toContain('in ');
  });
});
