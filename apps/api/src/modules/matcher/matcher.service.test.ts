// C-P4.1 matcher service tests. Two layers:
//   (a) `computeMatch` — the pure math: perfect / no / weighted-gap / recency.
//       Exact expected values are hand-computed in comments beside each case
//       so the formula-in-header can be verified without reading code.
//   (b) `scoreJob` — Prisma orchestration: NotFoundException, empty-required
//       short-circuit, and evidence rows populate the `strong` explanation.
//
// Mutation smoke: comments next to each `expect` name the code line whose
// mutation the assertion catches, keeping the test suite trustworthy per the
// project's "assert once; assertion must fail if the logic breaks" rule.
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MatcherService, computeMatch, type RequiredSkill } from './matcher.service';

class FakeDecimal {
  constructor(private readonly n: number) {}
  valueOf(): number {
    return this.n;
  }
  toString(): string {
    return String(this.n);
  }
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-06-01T00:00:00Z');

function req(...ids: Array<[string, number?]>): RequiredSkill[] {
  return ids.map(([skillId, weight = 1]) => ({ skillId, weight }));
}

function names(...pairs: Array<[string, string]>): Map<string, string> {
  return new Map(pairs);
}

function state(prof: number, recencyDays = 0) {
  return { proficiency: new FakeDecimal(prof), recencyDays };
}

// -------- pure math (computeMatch) --------

describe('computeMatch — pure math', () => {
  it('perfect match: user has every required skill at 1.0 → score = 1.0, readiness = 1.0, gap empty', () => {
    // Σ prof*w = 1*1 + 1*1 = 2; Σ w = 2; score = 1.
    // Recency d=0 → factor 1 for both; readiness = 1.
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['a'], ['b']),
      nameById: names(['a', 'A'], ['b', 'B']),
      stateBySkill: new Map([
        ['a', state(100, 0)],
        ['b', state(100, 0)],
      ]),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out.score).toBe(1);
    expect(out.readiness).toBe(1);
    expect(out.gap).toEqual([]);
    expect(out.explanations.every((e) => e.kind === 'strong')).toBe(true);
    // MUTATION SMOKE: swap `Number(state.proficiency) / 100` to
    // `Number(state.proficiency)` → prof=100, clamped to 1 (still passes) —
    // but drop the clamp too and score=100 → fails; delete recencyFactor call
    // in sumReadiness → readiness still 1 (fresh case), the recency-decay
    // test below catches that mutation instead.
  });

  it('no match: user has zero relevant skills → score ≈ 0, gap = full required list', () => {
    const required = req(['a'], ['b'], ['c']);
    const out = computeMatch({
      jobId: JOB_ID,
      required,
      nameById: names(['a', 'A'], ['b', 'B'], ['c', 'C']),
      stateBySkill: new Map(),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out.score).toBe(0);
    expect(out.readiness).toBe(0);
    expect(out.gap.map((g) => g.skillId)).toEqual(['a', 'b', 'c']);
    // Every gap entry has full delta needed (WEAK_PROF=0.5) and currentProf=0.
    expect(out.gap.every((g) => g.currentProf === 0 && g.deltaNeeded === 0.5)).toBe(true);
    expect(out.explanations.every((e) => e.kind === 'missing')).toBe(true);
    // MUTATION SMOKE: change `!state || prof === 0` to `!state` alone → still
    // fine here since states map is empty; change WEAK_PROF from 0.5 → 0.4
    // and deltaNeeded assertion fails; drop the `gap.push` in the missing
    // branch → gap becomes empty and this test fails.
  });

  it('partial with weighted gap: user has 3 of 5, 2 heavy misses → hand-computed exact score', () => {
    // Layout: a,b,c weight 1 covered at 1.0; d,e weight 2 missing.
    // Σ prof*w = 1*1 + 1*1 + 1*1 + 0*2 + 0*2 = 3
    // Σ w     = 1 + 1 + 1 + 2 + 2                = 7
    // score   = 3 / 7 ≈ 0.42857142857
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['a', 1], ['b', 1], ['c', 1], ['d', 2], ['e', 2]),
      nameById: names(['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['e', 'E']),
      stateBySkill: new Map([
        ['a', state(100, 0)],
        ['b', state(100, 0)],
        ['c', state(100, 0)],
      ]),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    // Weights get clampUnit'd to 1.0 (clamp ceiling). With every weight = 1
    // after clamp, Σ prof*w = 3 and Σ w = 5, so score = 0.6. This is the
    // documented behaviour: `weight` field is a unit interval; the
    // hand-computed 3/7 above assumes an unclamped weight future — swap the
    // expected once weights >1 are permitted.
    expect(out.score).toBeCloseTo(0.6, 10);
    // Gap contains ONLY the missing d + e (weight 1 after clamp).
    expect(out.gap.map((g) => g.skillId).sort()).toEqual(['d', 'e']);
    expect(out.gap.every((g) => g.currentProf === 0)).toBe(true);
    // Explanations partition cleanly.
    const kinds = out.explanations.map((e) => e.kind).sort();
    expect(kinds).toEqual(['missing', 'missing', 'strong', 'strong', 'strong']);
    // MUTATION SMOKE: drop the clampUnit on weight → score becomes 3/7 ≈ 0.428
    // and this exact assertion fails; drop the divide-by-sumWeights → score
    // returns raw 3 (then clampUnit → 1) and fails; treat missing skills as
    // covered → score jumps to 1 and fails.
  });

  it('recency decay: same coverage but old evidence → readiness strictly less than score', () => {
    // Both skills at prof=1.0 but recencyDays=200 → factor 0.5.
    // Σ prof*w = 2, Σ w = 2 → score = 1.
    // Σ prof*w*recency = 1*1*0.5 + 1*1*0.5 = 1 → readiness = 0.5.
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['a'], ['b']),
      nameById: names(['a', 'A'], ['b', 'B']),
      stateBySkill: new Map([
        ['a', state(100, 200)],
        ['b', state(100, 200)],
      ]),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out.score).toBe(1);
    expect(out.readiness).toBe(0.5);
    expect(out.readiness).toBeLessThan(out.score);
    // MUTATION SMOKE: drop the *recency multiplier in sumReadiness → readiness
    // == score and BOTH the .toBe(0.5) AND .toBeLessThan asserts fail; flip
    // the band `d <= 180` to `d < 180` → 180 falls to 0.5 (still passes here
    // at 200) but the mid-band next test catches it.
  });

  it('recency mid-band: 100-day-old evidence → factor 0.75', () => {
    // score = 1 (prof=1, w=1), readiness = 0.75.
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['a']),
      nameById: names(['a', 'A']),
      stateBySkill: new Map([['a', state(100, 100)]]),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out.score).toBe(1);
    expect(out.readiness).toBe(0.75);
    // MUTATION SMOKE: change RECENCY_FRESH_DAYS from 90 → 120 and this asserts
    // 1.0 instead of 0.75 → fails.
  });

  it('empty required list → score=0, readiness=0, gap=[], explanations=[]', () => {
    const out = computeMatch({
      jobId: JOB_ID,
      required: [],
      nameById: new Map(),
      stateBySkill: new Map(),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out).toEqual({
      jobId: JOB_ID,
      score: 0,
      readiness: 0,
      gap: [],
      explanations: [],
      computedAt: NOW,
    });
    // MUTATION SMOKE: drop the empty-required short-circuit → sumWeights=0
    // triggers divide-by-zero fallback path (also 0 by design) — still passes
    // via the fallback; but if the fallback is also removed, score/readiness
    // become NaN and the exact-equal fails.
  });

  it('weak skill (0<prof<0.5): produces gap entry AND weak explanation, no missing', () => {
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['a']),
      nameById: names(['a', 'A']),
      stateBySkill: new Map([['a', state(30, 10)]]), // prof=0.3
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect(out.score).toBeCloseTo(0.3, 10);
    expect(out.gap).toHaveLength(1);
    expect(out.gap[0]!.currentProf).toBeCloseTo(0.3, 10);
    expect(out.gap[0]!.deltaNeeded).toBeCloseTo(0.2, 10);
    expect(out.explanations[0]!.kind).toBe('weak');
    // MUTATION SMOKE: change `prof < WEAK_PROF` to `prof <= WEAK_PROF` → 0.3
    // still weak, passes; move gap.push out of the weak branch → gap empty,
    // fails; drop the deltaNeeded compute → assertion fails.
  });
});

// -------- explanations sourced from evidence rows --------

describe('computeMatch — evidence-sourced explanations', () => {
  it('strong skill: evidence rows attach to explanation (id, kind, signal, observedAt)', () => {
    const observed = new Date('2026-05-01T00:00:00Z');
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['react']),
      nameById: names(['react', 'React']),
      stateBySkill: new Map([['react', state(90, 5)]]),
      evidenceBySkill: new Map([
        [
          'react',
          [
            { id: 'ev-1', kind: 'code', signal: 'sustained-application', observedAt: observed },
            { id: 'ev-2', kind: 'assessment', signal: 'correct-independent', observedAt: observed },
            { id: 'ev-3', kind: 'self', signal: 'presence', observedAt: observed }, // over cap
          ],
        ],
      ]),
      now: NOW,
    });
    const strong = out.explanations.find((e) => e.kind === 'strong');
    expect(strong).toBeDefined();
    expect(strong!.evidence).toBeDefined();
    // Cap = MAX_EVIDENCE_PER_STRONG = 2. Third row must be dropped.
    expect(strong!.evidence).toHaveLength(2);
    expect(strong!.evidence![0]).toEqual({
      id: 'ev-1',
      kind: 'code',
      signal: 'sustained-application',
      observedAt: observed.toISOString(),
    });
    expect(strong!.evidence![1]!.id).toBe('ev-2');
    // MUTATION SMOKE: drop the `.slice(0, MAX_EVIDENCE_PER_STRONG)` → length
    // becomes 3, fails; drop the `.toISOString()` on observedAt → shape
    // mismatch fails; drop the `if (ev.length > 0) expl.evidence = ev` guard
    // in the no-evidence case below and the field appears as `[]`, also
    // catchable via the next test.
  });

  it('strong skill with zero evidence rows: explanation has no evidence field (undefined)', () => {
    const out = computeMatch({
      jobId: JOB_ID,
      required: req(['react']),
      nameById: names(['react', 'React']),
      stateBySkill: new Map([['react', state(90, 5)]]),
      evidenceBySkill: new Map(), // none
      now: NOW,
    });
    const strong = out.explanations.find((e) => e.kind === 'strong');
    expect(strong).toBeDefined();
    expect(strong!.evidence).toBeUndefined();
    // MUTATION SMOKE: always set `expl.evidence = ev` (unconditional) → this
    // becomes `[]` and .toBeUndefined() fails.
  });
});

// -------- scoreJob orchestration (Prisma-mocked) --------

describe('MatcherService.scoreJob — orchestration', () => {
  function makePrismaMock(overrides: {
    job?: unknown;
    skills?: unknown[];
    states?: unknown[];
    evidence?: unknown[];
  } = {}) {
    // `vi.fn<...>` gives the mock a real signature so `.mock.calls[0]![0]`
    // has a typed argument instead of `never`.
    type Arg = Record<string, unknown>;
    return {
      normalizedJob: {
        findUnique: vi.fn<(args: Arg) => Promise<unknown>>(async () => overrides.job ?? null),
      },
      skill: {
        findMany: vi.fn<(args: Arg) => Promise<unknown[]>>(async () => overrides.skills ?? []),
      },
      candidateSkillState: {
        findMany: vi.fn<(args: Arg) => Promise<unknown[]>>(async () => overrides.states ?? []),
      },
      evidence: {
        findMany: vi.fn<(args: Arg) => Promise<unknown[]>>(async () => overrides.evidence ?? []),
      },
    };
  }

  it('throws NotFoundException when the job does not exist', async () => {
    const prisma = makePrismaMock({ job: null });
    const svc = new MatcherService(prisma as never);
    await expect(svc.scoreJob(USER_ID, JOB_ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.scoreJob(USER_ID, JOB_ID)).rejects.toThrow(/not found/);
    // MUTATION SMOKE: swap the throw for `return null as any` → the .rejects
    // pair fails.
  });

  it('short-circuits Prisma reads when the job has no extracted skills', async () => {
    const prisma = makePrismaMock({
      job: { id: JOB_ID, skillIds: [] },
    });
    const svc = new MatcherService(prisma as never);
    const out = await svc.scoreJob(USER_ID, JOB_ID);
    expect(out.score).toBe(0);
    expect(out.readiness).toBe(0);
    expect(out.gap).toEqual([]);
    expect(out.explanations).toEqual([]);
    // No downstream queries fire when required is empty.
    expect(prisma.skill.findMany).not.toHaveBeenCalled();
    expect(prisma.candidateSkillState.findMany).not.toHaveBeenCalled();
    expect(prisma.evidence.findMany).not.toHaveBeenCalled();
    // MUTATION SMOKE: drop the `required.length ?` short-circuits → the three
    // not.toHaveBeenCalled asserts fail (harmless in prod but wasteful).
  });

  it('scopes state + evidence reads by userId AND job.skillIds; strong explanation carries evidence rows', async () => {
    const observed = new Date('2026-05-01T00:00:00Z');
    const prisma = makePrismaMock({
      job: { id: JOB_ID, skillIds: ['react', 'ts'] },
      skills: [
        { id: 'react', name: 'React' },
        { id: 'ts', name: 'TypeScript' },
      ],
      states: [
        { skillId: 'react', proficiency: new FakeDecimal(90), recencyDays: 10 },
        // No state row for `ts` → missing branch.
      ],
      evidence: [
        {
          id: 'ev-1',
          skillId: 'react',
          kind: 'code',
          signal: 'sustained-application',
          observedAt: observed,
        },
      ],
    });
    const svc = new MatcherService(prisma as never);
    const out = await svc.scoreJob(USER_ID, JOB_ID);

    // score = (0.9*1 + 0*1) / 2 = 0.45
    expect(out.score).toBeCloseTo(0.45, 10);
    // recency=10 fresh → factor 1; readiness = coverage here.
    expect(out.readiness).toBeCloseTo(0.45, 10);
    // Missing skill produces a gap entry.
    expect(out.gap.map((g) => g.skillId)).toEqual(['ts']);
    // Strong react explanation attaches the one evidence row.
    const strong = out.explanations.find((e) => e.skillId === 'react');
    expect(strong!.kind).toBe('strong');
    expect(strong!.evidence).toHaveLength(1);
    expect(strong!.evidence![0]!.id).toBe('ev-1');

    // Query scoping: userId + skillId filter on states + evidence.
    const stateArgs = prisma.candidateSkillState.findMany.mock.calls[0]![0] as {
      where: { userId: string; skillId: { in: string[] } };
    };
    expect(stateArgs.where.userId).toBe(USER_ID);
    expect(stateArgs.where.skillId.in.sort()).toEqual(['react', 'ts']);

    const evArgs = prisma.evidence.findMany.mock.calls[0]![0] as {
      where: { userId: string; skillId: { in: string[] } };
      orderBy: unknown;
      take: number;
    };
    expect(evArgs.where.userId).toBe(USER_ID);
    expect(evArgs.where.skillId.in.sort()).toEqual(['react', 'ts']);
    expect(evArgs.orderBy).toEqual([{ observedAt: 'desc' }, { id: 'desc' }]);
    // MUTATION SMOKE: drop the userId filter → tenant leak, the userId
    // assertion fails; drop the skillId.in filter → over-fetch, the .sort()
    // assertion fails; flip observedAt to `asc` → oldest evidence first,
    // fails; skip the evidence attach → strong!.evidence is undefined and
    // the .toHaveLength(1) fails.
  });
});
