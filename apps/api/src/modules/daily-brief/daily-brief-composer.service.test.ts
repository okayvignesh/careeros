import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { DailyBriefComposerService } from './daily-brief-composer.service';

/**
 * E.3 composer: verifies the shape of the returned payload against a
 * seeded fake prisma. The composer is pure aggregation - the assertion
 * is that every field shows up, with sensible defaults on empty state.
 */

function fakePrisma(seed: {
  xpTotal?: number;
  xpDelta?: number;
  streak?: { currentDays: number; longestDays: number } | null;
  quests?: Array<{ id: string; reason: string; skillId: string }>;
  skills?: Array<{ id: string; name: string }>;
  applications?: Array<{ id: string; jobId: string; createdAt: Date }>;
  jobs?: Array<{
    id: string;
    title: string;
    company: string;
    location: string | null;
    sourcePostedAt: Date | null;
  }>;
  snapshot?: { snapshotAt: Date; statsJson: unknown } | null;
}): PrismaService {
  return {
    xpEvent: {
      aggregate: async (args: { where: { createdAt?: unknown } }) => ({
        _sum: {
          xp: args.where.createdAt !== undefined ? seed.xpDelta ?? 0 : seed.xpTotal ?? 0,
        },
      }),
    },
    streak: {
      findUnique: async () => (seed.streak !== undefined ? seed.streak : { currentDays: 0, longestDays: 0 }),
    },
    remediationTask: {
      findMany: async () => seed.quests ?? [],
    },
    application: {
      findMany: async () => seed.applications ?? [],
    },
    marketSnapshot: {
      findFirst: async () => seed.snapshot ?? null,
    },
    skill: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        (seed.skills ?? []).filter((s) => args.where.id.in.includes(s.id)),
    },
    normalizedJob: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        (seed.jobs ?? []).filter((j) => args.where.id.in.includes(j.id)),
    },
  } as unknown as PrismaService;
}

describe('DailyBriefComposerService.compose', () => {
  it('produces a full payload with all fields populated', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const svc = new DailyBriefComposerService(
      fakePrisma({
        xpTotal: 1420,
        xpDelta: 85,
        streak: { currentDays: 5, longestDays: 12 },
        quests: [
          { id: 'q1', reason: 'Practice React state', skillId: 's1' },
          { id: 'q2', reason: 'Deep-dive on hoisting', skillId: 's2' },
        ],
        skills: [
          { id: 's1', name: 'React' },
          { id: 's2', name: 'JavaScript' },
        ],
        applications: [
          { id: 'a1', jobId: 'j1', createdAt: new Date('2026-06-15T06:00:00Z') },
        ],
        jobs: [
          {
            id: 'j1',
            title: 'Senior Backend Engineer',
            company: 'Stripe',
            location: 'Remote',
            sourcePostedAt: new Date('2026-06-14T00:00:00Z'),
          },
        ],
        snapshot: {
          snapshotAt: new Date('2026-06-14T00:00:00Z'),
          statsJson: { topSkills: [{ skillName: 'Go', count: 12 }] },
        },
      }),
    );

    const brief = await svc.compose('u-1', now);
    expect(brief.userId).toBe('u-1');
    expect(brief.composedAt).toBe(now.toISOString());
    expect(brief.xp).toEqual({ totalXp: 1420, deltaLast24h: 85 });
    expect(brief.streak).toEqual({ currentDays: 5, longestDays: 12 });
    expect(brief.quests).toHaveLength(2);
    expect(brief.quests[0].skillName).toBe('React');
    expect(brief.jobMatches).toHaveLength(1);
    expect(brief.jobMatches[0].title).toBe('Senior Backend Engineer');
    expect(brief.jobMatches[0].company).toBe('Stripe');
    expect(brief.marketPulse?.risingSkill).toBe('Go');
    // MUTATION-SMOKE: swap topSkills for topRisers in the parser and this
    // assertion drops to null.
  });

  it('degrades gracefully on empty state', async () => {
    const svc = new DailyBriefComposerService(fakePrisma({ streak: null }));
    const brief = await svc.compose('u-2');
    expect(brief.xp).toEqual({ totalXp: 0, deltaLast24h: 0 });
    expect(brief.streak).toEqual({ currentDays: 0, longestDays: 0 });
    expect(brief.quests).toEqual([]);
    expect(brief.jobMatches).toEqual([]);
    expect(brief.marketPulse).toBeNull();
    // No ranking service injected -> no fabricated priorities.
    expect(brief.learningPriorities).toEqual([]);
  });

  it('injects the top scoped learning priorities with skill names (P2 §8)', async () => {
    const priorities = {
      rankFor: async () => [
        { skillId: 'k8s', priority: 0.9, reasons: ['high market demand', 'large gap vs target 0.7'], factors: {} },
        { skillId: 'ts', priority: 0.8, reasons: ['required by your target role'], factors: {} },
        { skillId: 'go', priority: 0.7, reasons: ['some market demand'], factors: {} },
        { skillId: 'rust', priority: 0.2, reasons: ['low'], factors: {} },
      ],
    };
    const svc = new DailyBriefComposerService(
      fakePrisma({
        skills: [
          { id: 'k8s', name: 'Kubernetes' },
          { id: 'ts', name: 'TypeScript' },
          { id: 'go', name: 'Go' },
        ],
      }),
      priorities as never,
    );
    const brief = await svc.compose('u-1');
    expect(brief.learningPriorities).toHaveLength(3);
    expect(brief.learningPriorities[0]).toEqual({
      skillId: 'k8s',
      skillName: 'Kubernetes',
      priority: 0.9,
      reason: 'high market demand; large gap vs target 0.7',
    });
    // Only the top 3 are injected.
    expect(brief.learningPriorities.map((p) => p.skillId)).toEqual(['k8s', 'ts', 'go']);
    // MUTATION SMOKE: drop the slice -> 4 rows appear and this fails.
  });

  it('degrades gracefully (empty priorities, no throw) when ranking fails', async () => {
    const priorities = {
      rankFor: async () => {
        throw new Error('no market scope');
      },
    };
    const svc = new DailyBriefComposerService(fakePrisma({}), priorities as never);
    const brief = await svc.compose('u-1');
    expect(brief.learningPriorities).toEqual([]);
    // MUTATION SMOKE: remove the try/catch -> compose() rejects.
  });

  it('is resilient to a job row missing from the join set', async () => {
    // App references j-missing but the followup fetch returns nothing.
    // The composer must not crash and must expose empty fields.
    const svc = new DailyBriefComposerService(
      fakePrisma({
        applications: [{ id: 'a1', jobId: 'j-missing', createdAt: new Date('2026-06-15T00:00:00Z') }],
        jobs: [],
      }),
    );
    const brief = await svc.compose('u-1');
    expect(brief.jobMatches).toHaveLength(1);
    expect(brief.jobMatches[0].title).toBe('');
    expect(brief.jobMatches[0].company).toBeNull();
    // MUTATION-SMOKE: change the fallback `job?.title ?? ''` to `job!.title`
    // and this throws.
  });
});
