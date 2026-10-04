// Regression for the list/detail score split: before this refactor the jobs
// list used `matchScoreForJob` from `@careeros/shared` (coverage-only) while
// `POST /matcher/score` used the weighted `MatcherService`. The same
// job/candidate could show two different scores. Both now call the one
// canonical scorer in `@careeros/job-pipeline` (`computeMatch` /
// `computeMatchResult`), and this test pins the equivalence.
import { describe, expect, it, vi } from 'vitest';
import { MatcherService } from './matcher.service';
import { JobsService } from '../jobs/jobs.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = '22222222-2222-2222-2222-222222222222';

// Fresh relative to the real clock so JobsService.list's 45d freshness gate
// never rejects the row (the matcher has no such gate).
const NOW = new Date();

const JOB = {
  id: JOB_ID,
  canonicalUrl: 'https://example.com/jobs/1',
  title: 'Backend Engineer',
  company: 'Acme',
  location: null,
  remote: true,
  description: 'TypeScript and React role.',
  sourcePostedAt: NOW,
  firstSeenAt: NOW,
  primarySource: 'remotive',
  state: 'unverified',
  skillIds: ['react', 'ts'],
};

// react: prof 0.8, fresh; ts: prof 0.4, stale.
// weighted score = (0.8*1 + 0.4*1) / 2 = 0.6
const STATES = [
  { skillId: 'react', proficiency: 80, recencyDays: 10 },
  { skillId: 'ts', proficiency: 40, recencyDays: 200 },
];

function makePrisma() {
  return {
    normalizedJob: {
      findMany: vi.fn(async () => [JOB]),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => ({ id: JOB.id, skillIds: JOB.skillIds })),
    },
    candidateSkillState: { findMany: vi.fn(async () => STATES) },
    skill: {
      findMany: vi.fn(async () => [
        { id: 'react', name: 'React' },
        { id: 'ts', name: 'TypeScript' },
      ]),
    },
    evidence: { findMany: vi.fn(async () => []) },
  };
}

const prefsStub = {
  get: async () => ({
    remoteOnly: false,
    mustHaveSkills: [] as string[],
    dealbreakerSkills: [] as string[],
    companyBlacklist: [] as string[],
  }),
};

describe('match score consistency — jobs list vs job detail', () => {
  it('list and detail return the identical weighted score for the same job/candidate', async () => {
    const prisma = makePrisma();
    const jobs = new JobsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      prefsStub as never,
      {} as never,
      { resolve: async () => ({ values: {}, secrets: {} }) } as never,
    );
    const matcher = new MatcherService(prisma as never);

    const listOut = await jobs.list({ userId: USER_ID, limit: 50, offset: 0 });
    const detail = await matcher.scoreJob(USER_ID, JOB_ID);

    expect(listOut.jobs).toHaveLength(1);
    // The load-bearing assertion: one scorer, one number.
    expect(listOut.jobs[0]!.match.score).toBe(detail.score);
    expect(detail.score).toBeCloseTo(0.6, 10);
    // List projection stays honest about coverage.
    const listMatch = listOut.jobs[0]!.match;
    expect(listMatch.score).toBeCloseTo(0.6, 10);
    expect(listMatch.matched).toBe(1);
    expect(listMatch.total).toBe(2);
    expect(listMatch.missing).toEqual(['ts']);
    // MUTATION SMOKE: point JobsService.list back at the old coverage-only
    // `matchScoreForJob` → list score becomes 1 (2/2 present) while detail
    // stays 0.6 and the .toBe(detail.score) fails.
  });
});
