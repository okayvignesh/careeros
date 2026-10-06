// C-P2.6b: quest generator tests. Feeds hand-built LearningPriority rows into
// the pure `buildPlan` and asserts prereq quests land first, horizon caps
// are respected, kinds are correct, hours come from the table, reasons are
// non-empty. The `QuestGeneratorService.plan` wrapper is smoke-tested with
// a stubbed `LearningPriorityService`.

import { describe, expect, it, vi } from 'vitest';
import { buildPlan, HOURS_TABLE, QuestGeneratorService } from './quest-generator.service';
import type { LearningPriorityRow } from '../skills/learning-priority';

function row(
  skillId: string,
  priority: number,
  overrides: Partial<LearningPriorityRow['factors']> = {},
  reasons: string[] = ['some market demand'],
): LearningPriorityRow {
  return {
    skillId,
    priority,
    reasons,
    factors: {
      current: 0,
      historical: 0,
      demand: 0.5,
      gap: 0.5,
      recency: 0.4,
      targetRole: false,
      ...overrides,
    },
  };
}

describe('buildPlan', () => {
  it('emits unlock-prereq quests BEFORE the target quest', () => {
    // User wants nextjs; owns nothing. Prereqs = react -> {js, html, css}.
    const ranked = [row('nextjs', 0.9)];
    const plan = buildPlan(ranked, 25);

    // nextjs must exist and must appear after all its prereqs.
    const idx = (s: string) => plan.findIndex((q) => q.skillId === s);
    expect(idx('nextjs')).toBeGreaterThanOrEqual(0);
    expect(idx('react')).toBeGreaterThan(-1);
    expect(idx('js')).toBeGreaterThan(-1);
    expect(idx('html')).toBeGreaterThan(-1);
    expect(idx('css')).toBeGreaterThan(-1);
    expect(idx('nextjs')).toBeGreaterThan(idx('react'));
    expect(idx('react')).toBeGreaterThan(idx('js'));
    expect(idx('react')).toBeGreaterThan(idx('css'));
    expect(idx('css')).toBeGreaterThan(idx('html'));

    // The prereqs must be kind='unlock-prereq'; nextjs is kind='reach-target'.
    expect(plan.find((q) => q.skillId === 'react')!.kind).toBe('unlock-prereq');
    expect(plan.find((q) => q.skillId === 'js')!.kind).toBe('unlock-prereq');
    expect(plan.find((q) => q.skillId === 'nextjs')!.kind).toBe('reach-target');
    // MUTATION SMOKE: skip the addWithPrereqs recursion -> no prereq quests
    // appear and both prereqs asserts fail.
  });

  it('kind=sharpen-existing when user already has some proficiency in a top target', () => {
    const ranked = [row('react', 0.8, { current: 0.4 })];
    const plan = buildPlan(ranked, 5);
    const react = plan.find((q) => q.skillId === 'react')!;
    expect(react.kind).toBe('sharpen-existing');
    // MUTATION SMOKE: swap the ternary so current>0 maps to 'reach-target'
    // -> this asserts fails.
  });

  it('kind=reach-target when user has zero proficiency in a top target', () => {
    const ranked = [row('kubernetes', 0.8, { current: 0 })];
    const plan = buildPlan(ranked, 25);
    const k = plan.find((q) => q.skillId === 'kubernetes')!;
    expect(k.kind).toBe('reach-target');
  });

  it('drops mastered skills entirely (current >= 0.7 = mastered)', () => {
    const ranked = [
      row('react', 0.9, { current: 0.85 }), // mastered
      row('nextjs', 0.85), // needs react, but react is mastered
    ];
    const plan = buildPlan(ranked, 25);
    expect(plan.find((q) => q.skillId === 'react')).toBeUndefined();
    // nextjs should still appear because react is satisfied.
    expect(plan.find((q) => q.skillId === 'nextjs')).toBeDefined();
    // MUTATION SMOKE: raise MASTERED_PROF to 0.99 -> react leaks back in.
  });

  it('respects horizon caps (week=5)', () => {
    // 4 top targets that transitively pull in many prereqs.
    const ranked = [
      row('nextjs', 0.9),
      row('nestjs', 0.85),
      row('kubernetes', 0.8),
      row('terraform', 0.75),
    ];
    const plan = buildPlan(ranked, 5);
    expect(plan.length).toBeLessThanOrEqual(5);
    // MUTATION SMOKE: drop the `.slice(0, maxItems)` -> length blows past 5.
  });

  it('respects horizon caps (month=12)', () => {
    const ranked = [
      row('nextjs', 0.9),
      row('nestjs', 0.85),
      row('kubernetes', 0.8),
      row('terraform', 0.75),
    ];
    const plan = buildPlan(ranked, 12);
    expect(plan.length).toBeLessThanOrEqual(12);
  });

  it('every quest has a non-empty reason string', () => {
    const ranked = [row('nextjs', 0.9)];
    const plan = buildPlan(ranked, 25);
    for (const q of plan) {
      expect(q.reason.length).toBeGreaterThan(0);
    }
    // MUTATION SMOKE: return '' from reason building -> this asserts fails.
  });

  it('estimatedHours comes from HOURS_TABLE, defaults to 20 for unknowns', () => {
    const ranked = [
      row('react', 0.9),
      row('exotic-unknown-skill', 0.85),
    ];
    const plan = buildPlan(ranked, 25);
    const react = plan.find((q) => q.skillId === 'react')!;
    expect(react.estimatedHours).toBe(HOURS_TABLE.react);
    expect(HOURS_TABLE.react).toBe(30);
    const exotic = plan.find((q) => q.skillId === 'exotic-unknown-skill');
    // Unknown skill has no prereqs in the graph so it lands as a leaf target.
    expect(exotic?.estimatedHours).toBe(20);
    // MUTATION SMOKE: change DEFAULT_HOURS to 999 -> the exotic asserts fails.
  });

  it('HOURS_TABLE covers the 30+ common skills spec requires', () => {
    expect(Object.keys(HOURS_TABLE).length).toBeGreaterThanOrEqual(30);
  });

  it('targetProficiency = 0.7 for target-role skills, 0.5 otherwise', () => {
    const ranked = [
      row('nodejs', 0.9, { targetRole: true }),
      row('ruby', 0.85, { targetRole: false }),
    ];
    const plan = buildPlan(ranked, 25);
    expect(plan.find((q) => q.skillId === 'nodejs')!.targetProficiency).toBe(0.7);
    expect(plan.find((q) => q.skillId === 'ruby')!.targetProficiency).toBe(0.5);
    // MUTATION SMOKE: hardcode 0.5 -> the nodejs asserts fails.
  });

  it('quest ids are unique per plan', () => {
    const ranked = [
      row('nextjs', 0.9),
      row('remix', 0.85), // both need react
    ];
    const plan = buildPlan(ranked, 25);
    const ids = new Set(plan.map((q) => q.id));
    expect(ids.size).toBe(plan.length);
  });

  it('empty ranking -> empty plan', () => {
    expect(buildPlan([], 5)).toEqual([]);
  });
});

describe('QuestGeneratorService.plan', () => {
  it('defaults horizon=week (cap=5) and passes-through to buildPlan', async () => {
    const rankFor = vi.fn(async (): Promise<LearningPriorityRow[]> => [
      row('kubernetes', 0.9),
      row('terraform', 0.85),
    ]);
    const svc = new QuestGeneratorService({ rankFor } as never);
    const plan = await svc.plan('u1');
    expect(rankFor).toHaveBeenCalledWith('u1');
    expect(plan.length).toBeLessThanOrEqual(5);
    // MUTATION SMOKE: change default horizon to 'quarter' -> length can exceed 5.
  });

  it('respects opts.maxItems override', async () => {
    const rankFor = vi.fn(async (): Promise<LearningPriorityRow[]> => [
      row('nextjs', 0.9),
      row('nestjs', 0.85),
      row('kubernetes', 0.8),
    ]);
    const svc = new QuestGeneratorService({ rankFor } as never);
    const plan = await svc.plan('u1', { maxItems: 2 });
    expect(plan.length).toBe(2);
  });

  it('respects targetHorizon=quarter (cap=25)', async () => {
    const rankFor = vi.fn(async (): Promise<LearningPriorityRow[]> => [
      row('nextjs', 0.9),
      row('nestjs', 0.85),
      row('kubernetes', 0.8),
    ]);
    const svc = new QuestGeneratorService({ rankFor } as never);
    const plan = await svc.plan('u1', { targetHorizon: 'quarter' });
    expect(plan.length).toBeLessThanOrEqual(25);
  });

  it('inherits the market-scoped ranking: two profiles over one corpus yield different quests (P2 §8)', async () => {
    // Scoping lives entirely in LearningPriorityService; the generator must
    // pass the scoped ranking straight through with no duplicate geo logic.
    const usProfile = vi.fn(async (): Promise<LearningPriorityRow[]> => [
      row('kubernetes', 0.9, { current: 0, targetRole: true }),
      row('typescript', 0.85),
    ]);
    const deProfile = vi.fn(async (): Promise<LearningPriorityRow[]> => [
      row('java', 0.9, { current: 0, targetRole: true }),
      row('spring', 0.85),
    ]);
    const us = await new QuestGeneratorService({ rankFor: usProfile } as never).plan('u1', {
      maxItems: 5,
    });
    const de = await new QuestGeneratorService({ rankFor: deProfile } as never).plan('u1', {
      maxItems: 5,
    });
    const ids = (q: typeof us) => new Set(q.map((x) => x.skillId));
    expect(ids(us)).not.toEqual(ids(de));
    expect(ids(us).has('java')).toBe(false);
    expect(ids(de).has('kubernetes')).toBe(false);
  });
});
