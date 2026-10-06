import { describe, expect, it } from 'vitest';
import {
  RepositoryAnalysisService,
  aiAssistLevel,
  computeRepositoryAnalysis,
  evidenceStrength,
  utcWeekStart,
  type RawEvidenceRow,
} from './repository-analysis.service';

const NOW = new Date('2026-10-04T12:00:00.000Z');

function row(overrides: Partial<RawEvidenceRow>): RawEvidenceRow {
  return {
    skillId: 'ts',
    skillName: 'TypeScript',
    skillCluster: 'language',
    signal: 'presence',
    weightHint: null,
    observedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    refKind: 'github_repo',
    repoId: '1',
    repoRef: 'me/app',
    fullName: 'me/app',
    language: 'TypeScript',
    bytes: 1000,
    sha: null,
    isPrivate: false,
    pushedAt: '2026-09-20T00:00:00.000Z',
    aiConfidence: null,
    ...overrides,
  };
}

describe('repository analysis pure helpers', () => {
  it('derives strength from weightHint and volume', () => {
    expect(evidenceStrength(null, 1)).toBe(2);
    expect(evidenceStrength(0.6, 1)).toBe(3);
    expect(evidenceStrength(0.8, 1)).toBe(4);
    expect(evidenceStrength(0.6, 5)).toBe(4);
    expect(evidenceStrength(1, 10)).toBe(5);
  });

  it('buckets ai-assist likelihood at the documented thresholds', () => {
    expect(aiAssistLevel(null)).toBe('unavailable');
    expect(aiAssistLevel(0.1)).toBe('low');
    expect(aiAssistLevel(0.3)).toBe('medium');
    expect(aiAssistLevel(0.75)).toBe('high');
  });

  it('anchors weeks to Monday in UTC', () => {
    expect(utcWeekStart(new Date('2026-10-04T23:00:00.000Z'))).toBe('2026-09-28');
    expect(utcWeekStart(new Date('2026-09-28T00:00:00.000Z'))).toBe('2026-09-28');
  });
});

describe('computeRepositoryAnalysis', () => {
  it('computes language mix, skills, commit activity and AI likelihood from rows', () => {
    const rows: RawEvidenceRow[] = [
      // Two languages on repo 1.
      row({ bytes: 900, skillId: 'ts', skillName: 'TypeScript' }),
      row({ bytes: 100, skillId: 'sql', skillName: 'SQL' }),
      // Three distinct commits, two flagged as likely AI-assisted.
      row({
        refKind: 'commit_touch',
        skillId: 'ts',
        signal: 'presence',
        weightHint: 0.6,
        sha: 'a1',
        observedAt: new Date('2026-10-01T00:00:00.000Z'),
        aiConfidence: 0.7,
      }),
      row({
        refKind: 'commit_touch',
        skillId: 'ts',
        signal: 'presence',
        weightHint: 0.6,
        sha: 'a2',
        observedAt: new Date('2026-10-01T00:00:00.000Z'),
        aiConfidence: 0.6,
      }),
      row({
        refKind: 'commit_authorship',
        skillId: 'ts',
        signal: 'sustained-application',
        weightHint: 0.8,
        sha: 'a3',
        observedAt: new Date('2026-09-22T00:00:00.000Z'),
        aiConfidence: 0.1,
      }),
      // A second repo, only a framework hint.
      row({
        refKind: 'framework_hint',
        repoId: '2',
        repoRef: 'me/infra',
        fullName: 'me/infra',
        skillId: 'docker',
        skillName: 'Docker',
        skillCluster: 'tool',
        signal: 'presence',
        weightHint: 0.55,
        sha: 'b1',
        language: null,
        bytes: null,
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
        aiConfidence: 0.2,
      }),
    ];

    const result = computeRepositoryAnalysis(rows, 'me', NOW);

    expect(result.connected).toBe(true);
    expect(result.login).toBe('me');
    expect(result.repos).toHaveLength(2);

    const app = result.repos.find((r) => r.repoId === '1');
    expect(app).toBeDefined();
    expect(app?.fullName).toBe('me/app');
    expect(app?.totalBytes).toBe(1000);
    expect(app?.languages.map((l) => [l.name, l.percent])).toEqual([
      ['TypeScript', 90],
      ['SQL', 10],
    ]);
    expect(app?.commits).toBe(3);
    expect(app?.skills.map((s) => s.skillId).sort()).toEqual(['sql', 'ts']);
    expect(app?.skills.find((s) => s.skillId === 'ts')?.strength).toBe(4);
    expect(app?.aiAssist.meanConfidence).toBeCloseTo(0.47, 2);
    expect(app?.aiAssist.level).toBe('medium');
    expect(app?.aiAssist.flaggedCommits).toBe(2);
    // The two 2026-10-01 commits land in the week of 2026-09-28; a3 in 2026-09-21.
    const activity = new Map(app?.activity.map((a) => [a.weekStart, a.commits]));
    expect(activity.get('2026-09-28')).toBe(2);
    expect(activity.get('2026-09-21')).toBe(1);
    expect(app?.activity).toHaveLength(12);

    // Unscanned languages are not invented: repo 2 has no language rows.
    const infra = result.repos.find((r) => r.repoId === '2');
    expect(infra?.languages).toEqual([]);
    expect(infra?.skills.map((s) => s.skillId)).toEqual(['docker']);

    expect(result.totals.repos).toBe(2);
    expect(result.totals.commits).toBe(4);
    expect(result.totals.skills).toBe(3);
    expect(result.totals.languages[0]).toMatchObject({ skillId: 'ts', percent: 90 });
  });

  it('returns an empty connected analysis for no rows', () => {
    const result = computeRepositoryAnalysis([], 'me', NOW);
    expect(result.repos).toEqual([]);
    expect(result.totals).toEqual({ repos: 0, commits: 0, languages: [], skills: 0 });
  });
});

describe('RepositoryAnalysisService.getAnalysis', () => {
  it('reports disconnected with no CTA data when github is not connected', async () => {
    const prisma = {
      integration: { findUnique: async () => null },
      $queryRaw: async () => [],
    };
    const svc = new RepositoryAnalysisService(prisma as never);
    await expect(svc.getAnalysis('user-1')).resolves.toEqual({
      connected: false,
      login: null,
      repos: [],
      totals: { repos: 0, commits: 0, languages: [], skills: 0 },
    });
  });

  it('reads the login from integration metadata when connected', async () => {
    let queried = false;
    const prisma = {
      integration: {
        findUnique: async () => ({ status: 'connected', metadata: { login: 'octocat' } }),
      },
      $queryRaw: async () => {
        queried = true;
        return [];
      },
    };
    const svc = new RepositoryAnalysisService(prisma as never);
    const result = await svc.getAnalysis('user-1');
    expect(queried).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.login).toBe('octocat');
  });
});
