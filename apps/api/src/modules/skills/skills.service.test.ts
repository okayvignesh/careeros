// B-7: skills.service.ts is a thin Prisma read/join adapter — it does NOT own
// aggregation math, state transitions, dedup, or evidence pruning. That logic
// lives in packages/shared/src/knowledge-rules.ts (aggregation + level bands,
// tested in knowledge-rules.test.ts + knowledge-rules.property.test.ts) and in
// packages/aggregator/src/index.ts (persistence glue). Dedup + pruning are not
// implemented anywhere in the tree yet. See the report for scope reconciliation.
//
// These tests cover the mapping + left-join contract this service actually owns:
//   1. list(): every seeded skill appears, even without a state row (defaults).
//   2. list(): state row present → Prisma Decimal (proficiency/confidence) is
//      coerced to number via Number(), not left as Decimal|string.
//   3. list(): filters candidateSkillStates by userId + take:1; orders by
//      cluster asc, name asc.
//   4. detail(): NotFoundException when skill missing.
//   5. detail(): evidence + events mapped (weightHint Decimal→number|null,
//      Date→ISO string, sourceRef passthrough).
//   6. detail(): default state fields when no CandidateSkillState row exists.
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SkillsService } from './skills.service';

// Minimal stand-in for Prisma's Decimal. Real @prisma/client returns a Decimal
// instance whose Number(d) coerces via valueOf(); this mimics that contract so
// the service's `Number(st.proficiency)` path is exercised as it is in prod.
class FakeDecimal {
  constructor(private readonly n: number) {}
  valueOf(): number {
    return this.n;
  }
  toString(): string {
    return String(this.n);
  }
}

type PrismaMock = {
  skill: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  evidence: {
    findMany: ReturnType<typeof vi.fn>;
  };
  skillStateEvent: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

function makePrismaMock(overrides: Partial<{
  skillFindMany: unknown;
  skillFindUnique: unknown;
  evidenceFindMany: unknown;
  skillStateEventFindMany: unknown;
}> = {}): PrismaMock {
  return {
    skill: {
      findMany: vi.fn(async () => overrides.skillFindMany ?? []),
      findUnique: vi.fn(async () => overrides.skillFindUnique ?? null),
    },
    evidence: {
      findMany: vi.fn(async () => overrides.evidenceFindMany ?? []),
    },
    skillStateEvent: {
      findMany: vi.fn(async () => overrides.skillStateEventFindMany ?? []),
    },
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('SkillsService.list', () => {
  it('returns default state fields for skills the user has no CandidateSkillState row for (left-join contract)', async () => {
    // Seeded skill with an empty candidateSkillStates array (Prisma include with
    // where: { userId } returns [] when the user has never touched this skill).
    const prisma = makePrismaMock({
      skillFindMany: [
        {
          id: 'skill-react',
          name: 'React',
          cluster: 'framework',
          aliases: ['reactjs', 'react.js'],
          candidateSkillStates: [],
        },
      ],
    });
    const svc = new SkillsService(prisma as never);

    const rows = await svc.list(USER_ID);

    expect(rows).toEqual([
      {
        id: 'skill-react',
        name: 'React',
        cluster: 'framework',
        aliases: ['reactjs', 'react.js'],
        level: 1,
        proficiency: 0,
        confidence: 0,
        evidenceCount: 0,
        recencyDays: -1,
        historicalDemonstrated: false,
      },
    ]);
    // MUTATION SMOKE: change the `level ?? 1` default in skills.service.ts to
    // `?? 0` → this exact-equal fails; change recencyDays default from -1 to 0
    // (which the UI treats as "seen today", a real defect) → also fails.
  });

  it('coerces Prisma Decimal proficiency + confidence to number, and propagates state row fields', async () => {
    const prisma = makePrismaMock({
      skillFindMany: [
        {
          id: 'skill-ts',
          name: 'TypeScript',
          cluster: 'language',
          aliases: [],
          candidateSkillStates: [
            {
              userId: USER_ID,
              skillId: 'skill-ts',
              proficiency: new FakeDecimal(73.25),
              confidence: new FakeDecimal(0.812),
              recencyDays: 14,
              historicalDemonstrated: true,
              evidenceCount: 9,
              level: 42,
            },
          ],
        },
      ],
    });
    const svc = new SkillsService(prisma as never);

    const [row] = await svc.list(USER_ID);

    expect(row).toEqual({
      id: 'skill-ts',
      name: 'TypeScript',
      cluster: 'language',
      aliases: [],
      level: 42,
      proficiency: 73.25,
      confidence: 0.812,
      evidenceCount: 9,
      recencyDays: 14,
      historicalDemonstrated: true,
    });
    // Guard against a subtle regression: the values MUST be JS numbers, not
    // Decimal instances or strings, or the UI (which does arithmetic on them)
    // silently NaNs. `typeof` catches "left as Decimal" and "toString-coerced".
    expect(typeof row!.proficiency).toBe('number');
    expect(typeof row!.confidence).toBe('number');
    // MUTATION SMOKE: drop the `Number()` calls in skills.service.ts (return
    // `st.proficiency` directly) → typeof is 'object', both asserts fail.
  });

  it('scopes candidateSkillStates by userId with take:1 and orders by cluster,name', async () => {
    const prisma = makePrismaMock({ skillFindMany: [] });
    const svc = new SkillsService(prisma as never);

    await svc.list(USER_ID);

    expect(prisma.skill.findMany).toHaveBeenCalledOnce();
    const args = prisma.skill.findMany.mock.calls[0]![0] as {
      include: { candidateSkillStates: { where: { userId: string }; take: number } };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    };
    expect(args.include.candidateSkillStates.where.userId).toBe(USER_ID);
    expect(args.include.candidateSkillStates.take).toBe(1);
    expect(args.orderBy).toEqual([{ cluster: 'asc' }, { name: 'asc' }]);
    // MUTATION SMOKE: drop the userId filter → tenant leak, this test fails;
    // change take from 1 to undefined → payload can balloon, fails; flip order
    // to `desc` → UI ordering regresses, fails.
  });
});

describe('SkillsService.detail', () => {
  it('throws NotFoundException when the skill does not exist', async () => {
    const prisma = makePrismaMock({ skillFindUnique: null });
    const svc = new SkillsService(prisma as never);

    await expect(svc.detail(USER_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.detail(USER_ID, 'nope')).rejects.toThrow(/Skill 'nope' not found/);
    // Neither evidence nor events should be queried after the miss.
    expect(prisma.evidence.findMany).not.toHaveBeenCalled();
    expect(prisma.skillStateEvent.findMany).not.toHaveBeenCalled();
    // MUTATION SMOKE: replace the `throw new NotFoundException` with a silent
    // `return null` → the .rejects assertion fails; move the throw AFTER the
    // Promise.all → the "not.toHaveBeenCalled" pair fails.
  });

  it('maps evidence and events: weightHint Decimal→number, null→null, Date→ISO, sourceRef passthrough', async () => {
    const observed = new Date('2026-01-15T12:00:00Z');
    const ts = new Date('2026-01-15T13:00:00Z');
    const prisma = makePrismaMock({
      skillFindUnique: {
        id: 'skill-node',
        name: 'Node.js',
        cluster: 'runtime',
        aliases: ['node'],
        candidateSkillStates: [
          {
            userId: USER_ID,
            skillId: 'skill-node',
            proficiency: new FakeDecimal(55.0),
            confidence: new FakeDecimal(0.5),
            recencyDays: 3,
            historicalDemonstrated: true,
            evidenceCount: 4,
            level: 30,
          },
        ],
      },
      evidenceFindMany: [
        {
          id: 'ev-1',
          kind: 'code',
          signal: 'sustained-application',
          weightHint: new FakeDecimal(0.85),
          sourceRef: { kind: 'repo', id: 'owner/repo' },
          observedAt: observed,
        },
        {
          id: 'ev-2',
          kind: 'self',
          signal: 'presence',
          weightHint: null,
          sourceRef: null,
          observedAt: observed,
        },
      ],
      skillStateEventFindMany: [
        {
          id: 'evt-1',
          rule: 'aggregate',
          reason: 'Aggregated 2 evidence row(s); level 1 to 30',
          evidenceId: 'ev-1',
          beforeJson: null,
          afterJson: { proficiency: 55, confidence: 0.5 },
          timestamp: ts,
        },
      ],
    });
    const svc = new SkillsService(prisma as never);

    const out = await svc.detail(USER_ID, 'skill-node');

    expect(out.skill.proficiency).toBe(55.0);
    expect(out.skill.confidence).toBe(0.5);
    expect(out.skill.level).toBe(30);
    expect(out.skill.historicalDemonstrated).toBe(true);

    expect(out.evidence).toEqual([
      {
        id: 'ev-1',
        kind: 'code',
        signal: 'sustained-application',
        weightHint: 0.85,
        sourceRef: { kind: 'repo', id: 'owner/repo' },
        observedAt: observed.toISOString(),
      },
      {
        id: 'ev-2',
        kind: 'self',
        signal: 'presence',
        weightHint: null,
        sourceRef: null,
        observedAt: observed.toISOString(),
      },
    ]);

    expect(out.events).toEqual([
      {
        id: 'evt-1',
        rule: 'aggregate',
        reason: 'Aggregated 2 evidence row(s); level 1 to 30',
        evidenceId: 'ev-1',
        beforeJson: null,
        afterJson: { proficiency: 55, confidence: 0.5 },
        timestamp: ts.toISOString(),
      },
    ]);

    // Scoping + limits contract for the two follow-up queries.
    const evArgs = prisma.evidence.findMany.mock.calls[0]![0] as {
      where: { userId: string; skillId: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      take: number;
    };
    expect(evArgs.where).toEqual({ userId: USER_ID, skillId: 'skill-node' });
    expect(evArgs.orderBy).toEqual([{ observedAt: 'desc' }, { id: 'desc' }]);
    expect(evArgs.take).toBe(50);

    const evtArgs = prisma.skillStateEvent.findMany.mock.calls[0]![0] as {
      where: { userId: string; skillId: string };
      orderBy: Record<string, 'asc' | 'desc'>;
      take: number;
    };
    expect(evtArgs.where).toEqual({ userId: USER_ID, skillId: 'skill-node' });
    expect(evtArgs.orderBy).toEqual({ timestamp: 'desc' });
    expect(evtArgs.take).toBe(20);
    // MUTATION SMOKE: drop the `weightHint == null ? null : Number(...)` guard
    // → the ev-2 assertion (weightHint: null) fails or throws; remove
    // .toISOString() → equality on ISO string fails; drop the take:50 / take:20
    // caps → the pagination-fix guard in COMPLETION_PLAN C-P3.8 regresses.
  });

  it('returns default skill-state fields when the user has never touched the skill', async () => {
    const prisma = makePrismaMock({
      skillFindUnique: {
        id: 'skill-rust',
        name: 'Rust',
        cluster: 'language',
        aliases: [],
        candidateSkillStates: [],
      },
      evidenceFindMany: [],
      skillStateEventFindMany: [],
    });
    const svc = new SkillsService(prisma as never);

    const out = await svc.detail(USER_ID, 'skill-rust');

    expect(out.skill).toEqual({
      id: 'skill-rust',
      name: 'Rust',
      cluster: 'language',
      aliases: [],
      level: 1,
      proficiency: 0,
      confidence: 0,
      evidenceCount: 0,
      recencyDays: -1,
      historicalDemonstrated: false,
    });
    expect(out.evidence).toEqual([]);
    expect(out.events).toEqual([]);
    // MUTATION SMOKE: change the detail() default block to mirror list()'s
    // (currently they share the shape) — any drift produces divergent defaults
    // between the two endpoints, which this exact-equal locks down.
  });
});

describe('SkillsService.resolveByAlias', () => {
  // Shared taxonomy stand-in used by the resolveByAlias cases. Mirrors the
  // shape returned by the real `prisma.skill.findMany({ select: ... })` call.
  const TAXONOMY = [
    { id: 'kubernetes', name: 'Kubernetes', cluster: 'tool',      category: 'cloud',    aliases: ['kubernetes', 'k8s', 'kube'] },
    { id: 'postgres',   name: 'PostgreSQL', cluster: 'tool',      category: 'data',     aliases: ['postgres', 'postgresql', 'pg', 'psql'] },
    { id: 'react',      name: 'React',      cluster: 'framework', category: 'frontend', aliases: ['react', 'reactjs', 'react.js'] },
  ];

  function withTaxonomy(): PrismaMock {
    return makePrismaMock({ skillFindMany: TAXONOMY });
  }

  it('resolves "K8s" -> kubernetes via alias, case-insensitive', async () => {
    const svc = new SkillsService(withTaxonomy() as never);
    const hit = await svc.resolveByAlias('K8s');
    expect(hit).toEqual({
      id: 'kubernetes',
      name: 'Kubernetes',
      cluster: 'tool',
      category: 'cloud',
      matchedOn: 'alias',
    });
    // MUTATION SMOKE: drop the `.toLowerCase()` on the needle -> "K8s" no
    // longer matches "k8s" and this test flips to null.
  });

  it('resolves an exact id match with matchedOn=id', async () => {
    const svc = new SkillsService(withTaxonomy() as never);
    const hit = await svc.resolveByAlias('kubernetes');
    expect(hit?.matchedOn).toBe('id');
    expect(hit?.id).toBe('kubernetes');
  });

  it('resolves a display-name match with matchedOn=name', async () => {
    const svc = new SkillsService(withTaxonomy() as never);
    const hit = await svc.resolveByAlias('PostgreSQL');
    expect(hit?.matchedOn).toBe('name');
    expect(hit?.id).toBe('postgres');
  });

  it('returns null for an unknown term', async () => {
    const svc = new SkillsService(withTaxonomy() as never);
    const hit = await svc.resolveByAlias('cobol-on-cogs');
    expect(hit).toBeNull();
  });

  it('returns null for blank input without hitting the db', async () => {
    const prisma = withTaxonomy();
    const svc = new SkillsService(prisma as never);
    const hit = await svc.resolveByAlias('   ');
    expect(hit).toBeNull();
    expect(prisma.skill.findMany).not.toHaveBeenCalled();
    // MUTATION SMOKE: drop the `if (!needle) return null` guard -> the db is
    // queried on every whitespace call (wasteful) and the not.toHaveBeenCalled
    // assert fails.
  });

  it('prefers id > name > alias when several rows could match', async () => {
    // "postgres" is a taxonomy id AND an alias of the same row -- id wins.
    // Then invent a row whose name equals another row's alias to prove the
    // rank order picks name over alias.
    const prisma = makePrismaMock({
      skillFindMany: [
        { id: 'ambiguous', name: 'K8s', cluster: null, category: 'devops', aliases: [] },
        { id: 'kubernetes', name: 'Kubernetes', cluster: 'tool', category: 'cloud', aliases: ['k8s'] },
      ],
    });
    const svc = new SkillsService(prisma as never);
    const hit = await svc.resolveByAlias('k8s');
    // Name match on "K8s" (row 1) beats alias match on "k8s" (row 2).
    expect(hit?.id).toBe('ambiguous');
    expect(hit?.matchedOn).toBe('name');
  });
});

// ------ B-7 scope reconciliation (belongs in report, kept here for traceability) ------
// The plan row asked for tests of:
//   (a) aggregation math       — lives in packages/shared/src/knowledge-rules.ts
//   (b) state transitions      — same file (level bands + longInactivity rule)
//   (c) dedup                  — NOT IMPLEMENTED anywhere in the tree
//   (d) evidence pruning       — NOT IMPLEMENTED anywhere in the tree
// (a) and (b) are already covered by knowledge-rules.test.ts (imports
//   knowledge-rules.demo.ts, 14 asserts) and knowledge-rules.property.test.ts.
//   Duplicating them from the API layer would test the shared package a second
//   time from the wrong module — a real over-engineering risk.
// (c) and (d) can't be tested without production code to test. Writing an
//   assertion that "two identical evidence rows collapse" today would either
//   pass vacuously (because the aggregator never dedupes) or fail as a spec
//   for logic that isn't shipped. Flagged upward instead.
