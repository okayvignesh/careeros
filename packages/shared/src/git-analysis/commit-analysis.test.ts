import { describe, it, expect } from 'vitest';
import { analyzeRepoCommits, type CommitWithFiles } from './commit-analysis';

const me = 'me@example.com';
const other = 'other@example.com';

function tsRepo(): CommitWithFiles[] {
  return [
    {
      sha: 'a1',
      message: 'feat: add auth guard',
      filesTouched: 2,
      additions: 40,
      deletions: 5,
      authorEmail: me,
      committerEmail: me,
      authoredAt: new Date('2026-01-01T00:00:00Z'),
      files: ['src/auth/guard.ts', 'src/auth/index.ts'],
    },
    {
      sha: 'a2',
      message: 'chore: bump deps',
      filesTouched: 2,
      additions: 20,
      deletions: 20,
      authorEmail: me,
      committerEmail: me,
      authoredAt: new Date('2026-01-02T00:00:00Z'),
      files: ['package.json', 'pnpm-lock.yaml'],
    },
    {
      sha: 'a3',
      message: 'contributor upstream fix',
      filesTouched: 1,
      additions: 5,
      deletions: 0,
      authorEmail: other, // NOT the user
      committerEmail: other,
      authoredAt: new Date('2026-01-03T00:00:00Z'),
      files: ['src/other.ts'],
    },
  ];
}

function pythonRepo(): CommitWithFiles[] {
  return [
    {
      sha: 'p1',
      message: 'add django app',
      filesTouched: 3,
      additions: 100,
      deletions: 2,
      authorEmail: me,
      committerEmail: me,
      authoredAt: new Date('2026-02-01T00:00:00Z'),
      files: ['manage.py', 'app/models.py', 'requirements.txt'],
    },
  ];
}

function goRepoWithAiCommit(): CommitWithFiles[] {
  return [
    {
      sha: 'g1',
      message: 'refactor: sweeping change\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      filesTouched: 40,
      additions: 5000,
      deletions: 200,
      authorEmail: me,
      committerEmail: me,
      authoredAt: new Date('2026-03-01T00:00:00Z'),
      files: ['cmd/main.go', 'internal/x.go', 'internal/y.go'],
    },
  ];
}

describe('analyzeRepoCommits', () => {
  it('ignores commits whose author is not in the known-emails set', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/ts-app',
      commits: tsRepo(),
      knownEmails: { emails: [me] },
    });
    expect(res.ownCommitCount).toBe(2);
    // No row references sha 'a3'.
    for (const row of res.rows) {
      expect(row.sourceRef.sha).not.toBe('a3');
    }
  });

  it('emits touch + authorship rows for TS files', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/ts-app',
      commits: tsRepo(),
      knownEmails: { emails: [me] },
    });
    const touches = res.rows.filter((r) => r.sourceRef.kind === 'commit_touch');
    const authorship = res.rows.filter((r) => r.sourceRef.kind === 'commit_authorship');
    expect(touches.length).toBeGreaterThan(0);
    expect(authorship.some((r) => r.skillId === 'ts')).toBe(true);
    // Authorship row has a streakLength = number of commits on that skill.
    const tsAuth = authorship.find((r) => r.skillId === 'ts')!;
    expect(tsAuth.streakLength).toBe(1);
    expect(tsAuth.signal).toBe('sustained-application');
  });

  it('emits framework hints (nodejs) for package.json + pnpm-lock', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/ts-app',
      commits: tsRepo(),
      knownEmails: { emails: [me] },
    });
    const nodeHints = res.rows.filter(
      (r) => r.sourceRef.kind === 'framework_hint' && r.skillId === 'nodejs',
    );
    expect(nodeHints.length).toBe(1); // one commit had package.json
  });

  it('emits django + python + nodejs-style hints for a python repo', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/py-app',
      commits: pythonRepo(),
      knownEmails: { emails: [me] },
    });
    const hintSkills = new Set(
      res.rows.filter((r) => r.sourceRef.kind === 'framework_hint').map((r) => r.skillId),
    );
    expect(hintSkills.has('django')).toBe(true);
    expect(hintSkills.has('python')).toBe(true);
    const authorshipSkills = new Set(
      res.rows.filter((r) => r.sourceRef.kind === 'commit_authorship').map((r) => r.skillId),
    );
    expect(authorshipSkills.has('python')).toBe(true);
  });

  it('dampens weightHint on obviously-AI commits but never zeros', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/go-app',
      commits: goRepoWithAiCommit(),
      knownEmails: { emails: [me] },
    });
    // Every emitted row records aiAssistConfidence > 0.
    for (const row of res.rows) {
      expect(row.detail.aiAssistConfidence).toBeGreaterThan(0);
      expect(row.weightHint).toBeGreaterThan(0);
      expect(row.weightHint).toBeLessThanOrEqual(1);
    }
    // Damp actually took effect: touch-row weight for 'go' should be below the
    // undampened baseline (0.6).
    const goTouch = res.rows.find(
      (r) => r.sourceRef.kind === 'commit_touch' && r.skillId === 'go',
    )!;
    expect(goTouch.weightHint).toBeLessThan(0.6);
  });

  it('returns empty on empty-known-emails input, not a crash', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/ts-app',
      commits: tsRepo(),
      knownEmails: { emails: [] },
    });
    expect(res).toEqual({ ownCommitCount: 0, rows: [], perSkillTouches: [] });
  });

  it('perSkillTouches is sorted desc by touch count', () => {
    const res = analyzeRepoCommits({
      repoRef: 'me/ts-app',
      commits: [
        ...tsRepo(),
        // extra ts commit to push ts count above others
        {
          sha: 'a4',
          message: 'more ts',
          filesTouched: 1,
          additions: 5,
          deletions: 0,
          authorEmail: me,
          committerEmail: me,
          authoredAt: new Date('2026-01-04T00:00:00Z'),
          files: ['src/more.ts'],
        },
      ],
      knownEmails: { emails: [me] },
    });
    const counts = res.perSkillTouches.map((s) => s.touches);
    const sorted = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sorted);
  });
});
