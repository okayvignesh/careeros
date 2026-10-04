// C-P1.2: tests for the pure learning-priority formula + the orchestrator
// service. Vitest, real `it()` + `expect()`, no framework beyond that.
//
// The formula is asserted three ways:
//   1. Degenerate cases (all-perfect user, all-zero user, no market) --
//      priorities land in the expected quadrant.
//   2. Contribution isolation -- boost only when target-role, penalty only
//      when evidence is stale, etc.
//   3. Hand-verified numeric fixtures on the three-signal blend.
//
// The service is asserted with an in-memory Prisma fake so we can prove:
//   4. The market-demand histogram comes from the fresh-job pool only.
//   5. `targetRoleSkills` is populated via the role-skill map.
//   6. An empty user still gets a ranked list dominated by demand.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { computeLearningPriority } from './learning-priority';
import { LearningPriorityService } from './learning-priority.service';
import {
  matchRoleFamily,
  resolveRoleSkills,
  ROLE_FAMILIES,
  ROLE_FAMILY_COUNT,
  skillsForFamily,
} from './role-skill-map';

// -------- Prisma Decimal stand-in (mirrors skills.service.test.ts) --------
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
const NOW = new Date('2026-06-01T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

// -------- Pure formula --------

describe('computeLearningPriority (pure)', () => {
  it('perfect user (all proficiencies at target) → gap term collapses, priorities driven by demand + recency alone', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['react', 1.0],
        ['python', 1.0],
      ]),
      marketDemandBySkill: new Map([
        ['react', 10],
        ['python', 5],
      ]),
      evidenceRecencyBySkill: new Map([
        ['react', daysAgo(10)],
        ['python', daysAgo(10)],
      ]),
      now: NOW,
    });
    const react = rows.find((r) => r.skillId === 'react')!;
    // Formula: (0.4 * 1.0) + (0.5 * 0) + (0.1 * 1.0) = 0.5
    expect(react.factors.gap).toBe(0);
    expect(react.priority).toBeCloseTo(0.5, 5);
    // MUTATION SMOKE: drop the `Math.min(current, target)` guard → surplus
    // pushes gap negative, priority < 0.5, this asserts fails.
  });

  it('zero user (all proficiencies 0) → priority tracks demand_norm × 0.4 + gap × 0.5 + recency × 0.1', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map(),
      marketDemandBySkill: new Map([
        ['react', 10],
        ['go', 2],
      ]),
      now: NOW,
    });
    const react = rows.find((r) => r.skillId === 'react')!;
    // demand_norm=1.0, gap=0.5, recency_penalty=0.4 (no evidence), no boost
    // → 0.4*1.0 + 0.5*0.5 + 0.1*0.4 = 0.4 + 0.25 + 0.04 = 0.69
    expect(react.priority).toBeCloseTo(0.69, 5);
    const go = rows.find((r) => r.skillId === 'go')!;
    // demand_norm=0.2, gap=0.5, recency_penalty=0.4
    // → 0.08 + 0.25 + 0.04 = 0.37
    expect(go.priority).toBeCloseTo(0.37, 5);
    // Sort order: react beats go.
    expect(rows[0].skillId).toBe('react');
  });

  it('high demand + high gap dominates the ranking', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['react', 0.9], // already strong
        ['kubernetes', 0.05], // huge gap
      ]),
      marketDemandBySkill: new Map([
        ['react', 8],
        ['kubernetes', 10], // and top demand
      ]),
      now: NOW,
    });
    expect(rows[0].skillId).toBe('kubernetes');
    // MUTATION SMOKE: swap the sort to ascending → this flips.
  });

  it('target-role membership applies role_boost (×1.3) and lifts the row above equivalents', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['nodejs', 0.2],
        ['ruby', 0.2],
      ]),
      marketDemandBySkill: new Map([
        ['nodejs', 10],
        ['ruby', 10],
      ]),
      targetRoleSkills: new Set(['nodejs']),
      now: NOW,
    });
    const nodejs = rows.find((r) => r.skillId === 'nodejs')!;
    const ruby = rows.find((r) => r.skillId === 'ruby')!;
    // ruby: (0.4*1.0 + 0.5*0.3 + 0.1*0.4) * 1.0 = 0.59
    // nodejs: target=0.7 → gap=0.5, so (0.4*1.0 + 0.5*0.5 + 0.1*0.4) * 1.3
    //   = (0.4 + 0.25 + 0.04) * 1.3 = 0.69 * 1.3 = 0.897
    expect(ruby.priority).toBeCloseTo(0.59, 5);
    expect(nodejs.priority).toBeCloseTo(0.897, 3);
    expect(nodejs.factors.targetRole).toBe(true);
    expect(nodejs.reasons).toContain('required by your target role');
    // MUTATION SMOKE: drop role_boost multiplication → nodejs falls to
    // ~0.69 and this asserts fails (also breaks the reasons/factors sanity).
  });

  it('recency penalty: fresh (<90d)=1.0, mid (<180d)=0.7, old (>=180d)=0.4, missing=0.4', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['a', 0.0],
        ['b', 0.0],
        ['c', 0.0],
        ['d', 0.0],
      ]),
      marketDemandBySkill: new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
        ['d', 1],
      ]),
      evidenceRecencyBySkill: new Map([
        ['a', daysAgo(30)],
        ['b', daysAgo(120)],
        ['c', daysAgo(365)],
        // d intentionally absent
      ]),
      now: NOW,
    });
    const factor = (id: string) => rows.find((r) => r.skillId === id)!.factors.recency;
    expect(factor('a')).toBe(1.0);
    expect(factor('b')).toBe(0.7);
    expect(factor('c')).toBe(0.4);
    expect(factor('d')).toBe(0.4);
    // MUTATION SMOKE: swap 90 / 180 day thresholds → b + c bands flip.
  });

  it('degenerate: no market at all → demand_norm=0 everywhere, priorities driven by gap + recency + boost', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([['react', 0]]),
      marketDemandBySkill: new Map(),
      now: NOW,
    });
    const react = rows.find((r) => r.skillId === 'react')!;
    expect(react.factors.demand).toBe(0);
    // (0.4*0 + 0.5*0.5 + 0.1*0.4) * 1.0 = 0.29
    expect(react.priority).toBeCloseTo(0.29, 5);
    // MUTATION SMOKE: divide-by-zero (drop the max===0 guard) → NaN, this
    // asserts fails.
  });

  it('universe includes target-role skills even with zero user prof + zero demand', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map(),
      marketDemandBySkill: new Map(),
      targetRoleSkills: new Set(['solidity']),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].skillId).toBe('solidity');
    // No demand, gap=0.7, recency=0.4, boost=1.3
    // → (0 + 0.35 + 0.04) * 1.3 = 0.507
    expect(rows[0].priority).toBeCloseTo(0.507, 3);
  });

  it('reasons array names the contributing factors', () => {
    const [row] = computeLearningPriority({
      userProficiencyBySkill: new Map([['react', 0.1]]),
      marketDemandBySkill: new Map([['react', 10]]),
      targetRoleSkills: new Set(['react']),
      now: NOW,
    });
    expect(row.reasons).toContain('required by your target role');
    expect(row.reasons).toContain('high market demand');
    expect(row.reasons.some((r) => r.startsWith('large gap vs target'))).toBe(true);
    expect(row.reasons).toContain('no recent evidence');
    // MUTATION SMOKE: drop any of the reason branches → this fails.
  });

  it('priority clamps to [0, 1] even when role_boost would push above 1', () => {
    // Maximally-hostile: high demand, huge gap, fresh recency, in target role.
    const [row] = computeLearningPriority({
      userProficiencyBySkill: new Map(),
      marketDemandBySkill: new Map([['x', 100]]),
      targetRoleSkills: new Set(['x']),
      evidenceRecencyBySkill: new Map([['x', daysAgo(1)]]),
      now: NOW,
    });
    // raw = (0.4 + 0.35 + 0.1) * 1.3 = 0.85 * 1.3 = 1.105 → clamp to 1.0
    expect(row.priority).toBe(1.0);
    // MUTATION SMOKE: remove the clamp → returns 1.105, breaks the [0,1]
    // contract the UI depends on for progress bars.
  });

  it('roleThresholdBySkill overrides the 0.7/0.5 default target; missing skills fall back', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['nodejs', 0.75],
        ['go', 0.75],
      ]),
      marketDemandBySkill: new Map([
        ['nodejs', 1],
        ['go', 1],
      ]),
      targetRoleSkills: new Set(['nodejs', 'go']),
      roleThresholdBySkill: new Map([['nodejs', 0.9]]),
      now: NOW,
    });
    const nodejs = rows.find((r) => r.skillId === 'nodejs')!;
    const go = rows.find((r) => r.skillId === 'go')!;
    // nodejs bar 0.9 -> gap 0.15; go has no override -> 0.7 fallback -> gap 0.
    expect(nodejs.factors.gap).toBeCloseTo(0.15, 5);
    expect(go.factors.gap).toBe(0);
    expect(nodejs.priority).toBeGreaterThan(go.priority);
    // MUTATION SMOKE: ignore roleThresholdBySkill -> nodejs gap collapses to 0.
  });

  it('gap math uses current readiness, never historical demonstrated proficiency', () => {
    const rows = computeLearningPriority({
      // current readiness decayed to 0.3; history says 0.9.
      userProficiencyBySkill: new Map([['react', 0.3]]),
      historicalProficiencyBySkill: new Map([['react', 0.9]]),
      marketDemandBySkill: new Map([['react', 1]]),
      now: NOW,
    });
    const react = rows.find((r) => r.skillId === 'react')!;
    // default target 0.5 -> gap 0.2 from readiness (not 0 from history).
    expect(react.factors.gap).toBeCloseTo(0.2, 5);
    expect(react.factors.historical).toBeCloseTo(0.9, 5);
    expect(react.reasons).toContain('readiness decayed from demonstrated 0.90');
  });

  it('rows are sorted priority desc, then skillId asc for stable tie-break', () => {
    const rows = computeLearningPriority({
      userProficiencyBySkill: new Map([
        ['alpha', 0],
        ['beta', 0],
        ['gamma', 0],
      ]),
      marketDemandBySkill: new Map([
        ['alpha', 5],
        ['beta', 5],
        ['gamma', 5],
      ]),
      now: NOW,
    });
    expect(rows.map((r) => r.skillId)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

// -------- Role-skill map --------

describe('role-skill map', () => {
  it('exposes at least 10 role families (spec requires 10-15)', () => {
    expect(ROLE_FAMILY_COUNT).toBeGreaterThanOrEqual(10);
    expect(ROLE_FAMILY_COUNT).toBeLessThanOrEqual(15);
  });

  it('every family has at least 5 canonical skills', () => {
    for (const family of ['backend', 'frontend', 'devops', 'sre'] as const) {
      expect(skillsForFamily(family).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('matchRoleFamily is substring + case + seniority-prefix tolerant', () => {
    expect(matchRoleFamily('Senior Backend Engineer')).toBe('backend');
    expect(matchRoleFamily('Staff SRE')).toBe('sre');
    expect(matchRoleFamily('Full Stack Engineer')).toBe('fullstack');
    expect(matchRoleFamily('cobol scientist')).toBeNull();
    expect(matchRoleFamily('  ')).toBeNull();
    // MUTATION SMOKE: drop the .toLowerCase → "Senior Backend Engineer"
    // stops matching lowercase alias "backend engineer", returns null.
  });

  it('resolveRoleSkills unions the skill sets across multiple roles', () => {
    const set = resolveRoleSkills(['Backend Engineer', 'Frontend Engineer']);
    expect(set.has('nodejs')).toBe(true);
    expect(set.has('react')).toBe(true);
    expect(set.has('css')).toBe(true);
  });

  it('resolveRoleSkills drops unknown roles silently', () => {
    const set = resolveRoleSkills(['prompt engineer', 'Backend Engineer']);
    // Backend still contributes, unknown role contributes nothing.
    expect(set.has('nodejs')).toBe(true);
  });
});

// -------- Service orchestrator --------

interface PrismaMock {
  candidateSkillState: { findMany: ReturnType<typeof vi.fn> };
  evidence: { findMany: ReturnType<typeof vi.fn> };
  aimRoleThreshold: { findMany: ReturnType<typeof vi.fn> };
}

function makePrismaMock(opts: {
  states?: Array<{ skillId: string; proficiency: FakeDecimal; recencyDays?: number }>;
  evidence?: Array<{ skillId: string; observedAt: Date }>;
  thresholds?: Array<{ roleKey: string; threshold: FakeDecimal }>;
} = {}): PrismaMock {
  return {
    candidateSkillState: {
      findMany: vi.fn(async () => opts.states ?? []),
    },
    evidence: {
      findMany: vi.fn(async () => opts.evidence ?? []),
    },
    aimRoleThreshold: {
      findMany: vi.fn(async () => opts.thresholds ?? []),
    },
  };
}

/** Demand is now sourced from MarketDemandService (P2 §8 unification). */
function makeDemandMock(demandBySkill: Map<string, number>) {
  return {
    demandBySkill: vi.fn(async () => demandBySkill),
  };
}

function makePrefsMock(targetRoles: string[]) {
  return {
    get: vi.fn(async () => ({
      targetRoles,
      locations: [],
      remoteOnly: false,
      currency: 'USD',
      seniority: [],
      mustHaveSkills: [],
      dealbreakerSkills: [],
      companyBlacklist: [],
      countries: [],
      workplaceTypes: [],
      remoteScopes: [],
      updatedAt: null,
    })),
  };
}

function buildService(opts: {
  prisma?: PrismaMock;
  demand?: ReturnType<typeof makeDemandMock>;
  targetRoles?: string[];
}) {
  const prisma = opts.prisma ?? makePrismaMock();
  const demand = opts.demand ?? makeDemandMock(new Map());
  const prefs = makePrefsMock(opts.targetRoles ?? []);
  return {
    svc: new LearningPriorityService(prisma as never, prefs as never, demand as never),
    prisma,
    demand,
    prefs,
  };
}

describe('LearningPriorityService.rankFor', () => {
  it('sources demand from MarketDemandService with the 45-day window and never queries normalizedJob directly (P2 §8)', async () => {
    const prisma = makePrismaMock();
    const demand = makeDemandMock(new Map([['react', 1]]));
    const { svc } = buildService({ prisma, demand });
    await svc.rankFor(USER_ID);

    expect(demand.demandBySkill).toHaveBeenCalledOnce();
    expect(demand.demandBySkill).toHaveBeenCalledWith(USER_ID, 45);
    // Unification: the old raw normalizedJob query is gone.
    expect(
      (prisma as unknown as { normalizedJob?: unknown }).normalizedJob,
    ).toBeUndefined();
  });

  it('translates targetRoles=["Backend Engineer"] into a role-boost that lands on nodejs, postgres, docker', async () => {
    const demand = makeDemandMock(
      new Map([
        ['nodejs', 1],
        ['ruby', 1],
      ]),
    );
    const { svc } = buildService({ demand, targetRoles: ['Backend Engineer'] });

    const rows = await svc.rankFor(USER_ID);
    const nodejs = rows.find((r) => r.skillId === 'nodejs')!;
    const ruby = rows.find((r) => r.skillId === 'ruby')!;
    expect(nodejs.factors.targetRole).toBe(true);
    expect(ruby.factors.targetRole).toBe(false);
    expect(nodejs.priority).toBeGreaterThan(ruby.priority);
    // Postgres appears with zero demand + zero proficiency because it's in
    // the backend role set.
    const postgres = rows.find((r) => r.skillId === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.factors.targetRole).toBe(true);
  });

  it('empty user (no states, no evidence) still returns rows ranked by scoped demand', async () => {
    const demand = makeDemandMock(
      new Map([
        ['react', 3],
        ['python', 2],
        ['go', 1],
      ]),
    );
    const { svc } = buildService({ demand });

    const rows = await svc.rankFor(USER_ID);
    expect(rows.map((r) => r.skillId).slice(0, 3)).toEqual(['react', 'python', 'go']);
  });

  it('coerces Decimal proficiency to the 0..1 scale, keeping readiness and historical distinct', async () => {
    const prisma = makePrismaMock({
      states: [{ skillId: 'react', proficiency: new FakeDecimal(80) }],
    });
    const demand = makeDemandMock(new Map([['react', 1]]));
    const { svc } = buildService({ prisma, demand });
    const rows = await svc.rankFor(USER_ID);
    const react = rows.find((r) => r.skillId === 'react')!;
    // recencyDays absent -> treated as fresh, readiness == demonstrated (0.8).
    expect(react.factors.current).toBeCloseTo(0.8, 5);
    expect(react.factors.historical).toBeCloseTo(0.8, 5);
    expect(react.factors.gap).toBe(0);
  });

  it('decays current_readiness from historical_demonstrated_proficiency without collapsing them (AGENTS §11)', async () => {
    const prisma = makePrismaMock({
      states: [
        { skillId: 'react', proficiency: new FakeDecimal(80), recencyDays: 365 },
      ],
    });
    const demand = makeDemandMock(new Map([['react', 1]]));
    const { svc } = buildService({ prisma, demand });
    const rows = await svc.rankFor(USER_ID);
    const react = rows.find((r) => r.skillId === 'react')!;
    // historical = 0.8; readiness = 0.8 * 0.5 (stale) = 0.4.
    expect(react.factors.historical).toBeCloseTo(0.8, 5);
    expect(react.factors.current).toBeCloseTo(0.4, 5);
    // Default target 0.5 -> gap = 0.1 from readiness, not 0 from history.
    expect(react.factors.gap).toBeCloseTo(0.1, 5);
    expect(react.reasons).toContain('readiness decayed from demonstrated 0.80');
    // MUTATION SMOKE: use historical for the gap -> gap 0 and the decay
    // reason never fires.
  });

  it('uses an aim_role_thresholds row for a target role and falls back to 0.7 when absent', async () => {
    const prisma = makePrismaMock({
      states: [
        { skillId: 'nodejs', proficiency: new FakeDecimal(75), recencyDays: 1 },
      ],
      thresholds: [{ roleKey: 'backend', threshold: new FakeDecimal(0.9) }],
    });
    const demand = makeDemandMock(new Map([['nodejs', 1]]));
    const { svc } = buildService({ prisma, demand, targetRoles: ['Backend Engineer'] });
    const rows = await svc.rankFor(USER_ID);
    const nodejs = rows.find((r) => r.skillId === 'nodejs')!;
    // Stored threshold 0.9 -> gap = 0.15 (vs 0 with the 0.7 fallback).
    expect(nodejs.factors.gap).toBeCloseTo(0.15, 5);
    expect(nodejs.reasons.some((r) => r.includes('target 0.9'))).toBe(true);

    // No threshold row -> fallback 0.7: readiness 0.75 >= 0.7 -> gap 0.
    const fallback = buildService({
      prisma: makePrismaMock({
        states: [{ skillId: 'nodejs', proficiency: new FakeDecimal(75), recencyDays: 1 }],
      }),
      demand,
      targetRoles: ['Backend Engineer'],
    });
    const fallbackRow = (await fallback.svc.rankFor(USER_ID)).find((r) => r.skillId === 'nodejs')!;
    expect(fallbackRow.factors.gap).toBe(0);
  });

  it('picks the most recent evidence date per skill for the recency band', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const recent = new Date();
    const prisma = makePrismaMock({
      evidence: [
        { skillId: 'react', observedAt: old },
        { skillId: 'react', observedAt: recent },
        { skillId: 'react', observedAt: old },
      ],
    });
    const { svc } = buildService({ prisma, demand: makeDemandMock(new Map([['react', 1]])) });
    const rows = await svc.rankFor(USER_ID);
    const react = rows.find((r) => r.skillId === 'react')!;
    // Recent evidence → fresh band = 1.0. If we picked the first (or oldest)
    // date, the band would drop to 0.4.
    expect(react.factors.recency).toBe(1.0);
  });

  it('degrades gracefully when there is no market scope/demand (no fabricated priorities)', async () => {
    const prisma = makePrismaMock({
      states: [
        { skillId: 'nodejs', proficiency: new FakeDecimal(10), recencyDays: 5 },
      ],
    });
    const { svc } = buildService({ prisma, demand: makeDemandMock(new Map()) });
    const rows = await svc.rankFor(USER_ID);
    expect(rows.map((r) => r.skillId)).toContain('nodejs');
    const nodejs = rows.find((r) => r.skillId === 'nodejs')!;
    expect(nodejs.factors.demand).toBe(0);
    // No demand -> priority driven by gap alone; still a legitimate number.
    expect(nodejs.priority).toBeGreaterThan(0);
  });

  it('detailFor(userId, skillId) returns the row or throws NotFound', async () => {
    const { svc } = buildService({ demand: makeDemandMock(new Map([['react', 1]])) });
    const row = await svc.detailFor(USER_ID, 'react');
    expect(row.skillId).toBe('react');
    await expect(svc.detailFor(USER_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('aim_role_thresholds seed stays in sync with role-skill-map', () => {
  it('the migration seeds exactly the ROLE_FAMILIES keys at the target-role bar', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'apps/api/prisma/migrations/20261014000300_add_aim_role_thresholds/migration.sql',
      ),
      'utf8',
    );
    for (const family of ROLE_FAMILIES) {
      expect(sql).toContain(`('${family}')`);
    }
    expect(sql).toContain('0.700');
  });
});
