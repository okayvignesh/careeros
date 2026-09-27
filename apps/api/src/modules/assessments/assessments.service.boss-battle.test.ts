import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { xpForLevel } from '@careeros/shared';

// Same mock scaffold as the grading tests: swap DeepSeekProvider so no HTTP
// happens, and stub prompt render/wrap. Boss-battle submit forces every grade
// down the LLM path when a provider is configured; here we force rule fallback
// by not configuring one.

const { chatStructuredMock } = vi.hoisted(() => ({ chatStructuredMock: vi.fn() }));

vi.mock('@careeros/ai', async () => {
  const actual = await vi.importActual<typeof import('@careeros/ai')>('@careeros/ai');
  class FakeDeepSeekProvider {
    constructor(public readonly cfg: unknown) {}
    async chatStructured(args: unknown) {
      return chatStructuredMock(args);
    }
  }
  return {
    ...actual,
    DeepSeekProvider: FakeDeepSeekProvider,
    renderPrompt: () => ({ system: 'sys', user: 'usr', schema: {} }),
    wrapUntrusted: (content: string) => ({ content, sourceKind: 'user-input' as const }),
  };
});

vi.mock('@careeros/secrets', async () => {
  const actual = await vi.importActual<typeof import('@careeros/secrets')>('@careeros/secrets');
  return {
    ...actual,
    decrypt: () => 'fake-api-key',
    loadMasterKey: () => Buffer.alloc(32),
  };
});

vi.mock('../../common/aggregate-skill', () => ({
  syncSkillState: vi.fn(async () => ({
    state: { proficiency: 0.5, confidence: 0.5, recencyDays: 0, historicalDemonstrated: 1, evidenceCount: 1 },
    level: 2,
    before: null,
  })),
}));

vi.mock('../../common/llm-audit', () => ({ makeLlmAuditor: () => async () => {} }));

// eslint-disable-next-line import/first
import { AssessmentsService } from './assessments.service';

// -----------------------------------------------------------------------------
// Boss-battle-focused Prisma fake. Holds one active boss row and a small XP
// ledger that drives currentLevel. All mutations are recorded so we can
// inspect status transitions.
// -----------------------------------------------------------------------------

interface BossRow {
  id: string;
  userId: string;
  milestone: number;
  startedAt: Date;
  durationS: number;
  submittedAt: Date | null;
  score: string | null;
  status: 'active' | 'passed' | 'failed' | 'expired';
  questionIds: string[];
  attemptIds: string[];
}

interface FakeQuestion {
  id: string;
  kind: string;
  skillIds: string[];
  difficulty: string;
  prompt: string;
  keyPoints: string[];
  answerHint: string | null;
  flagged: boolean;
  sourceKind: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
}

function makeQ(id: string, skill: string): FakeQuestion {
  return {
    id,
    kind: 'knowledge',
    skillIds: [skill],
    difficulty: 'easy',
    prompt: `prompt ${id}`,
    keyPoints: ['x'],
    answerHint: null,
    flagged: false,
    sourceKind: null,
    sourceUrl: null,
    sourceAttribution: null,
  };
}

function fakePrisma(opts: { bosses?: BossRow[]; xpTotal?: number; questions?: FakeQuestion[]; evidenceSkills?: string[] }) {
  const bosses: BossRow[] = opts.bosses ?? [];
  const xpEvents: Array<{ reason: string; xp: number }> = [];
  if (opts.xpTotal) xpEvents.push({ reason: 'seed', xp: opts.xpTotal });
  const questions: FakeQuestion[] = opts.questions ?? [];
  const evidenceSkills = opts.evidenceSkills ?? [];
  const evidenceCreates: unknown[] = [];
  const updates: Array<{ id: string; data: Partial<BossRow> }> = [];
  let idSeq = 1;

  return {
    _bosses: bosses,
    calls: { updates, evidenceCreates, xpEvents },
    bossBattle: {
      findFirst: async ({ where }: { where: { id?: string; userId: string; status?: string; milestone?: number } }) => {
        const rows = bosses.filter((b) => {
          if (b.userId !== where.userId) return false;
          if (where.id && b.id !== where.id) return false;
          if (where.status && b.status !== where.status) return false;
          if (where.milestone != null && b.milestone !== where.milestone) return false;
          return true;
        });
        // orderBy startedAt desc — newest first
        rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return rows[0] ?? null;
      },
      findMany: async ({ where }: { where: { userId: string; status?: string } }) =>
        bosses.filter((b) => b.userId === where.userId && (!where.status || b.status === where.status)),
      create: async ({ data }: { data: { userId: string; milestone: number; questionIds: string[] } }) => {
        // Emulate partial-unique on (userId) WHERE status='active'.
        if (bosses.some((b) => b.userId === data.userId && b.status === 'active')) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row: BossRow = {
          id: `boss-${idSeq++}`,
          userId: data.userId,
          milestone: data.milestone,
          startedAt: new Date(),
          durationS: 1800,
          submittedAt: null,
          score: null,
          status: 'active',
          questionIds: data.questionIds,
          attemptIds: [],
        };
        bosses.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<BossRow> }) => {
        const row = bosses.find((b) => b.id === where.id);
        if (!row) throw new Error(`missing ${where.id}`);
        Object.assign(row, data);
        updates.push({ id: where.id, data });
        return row;
      },
    },
    xpEvent: {
      aggregate: async () => ({ _sum: { xp: xpEvents.reduce((a, e) => a + e.xp, 0) } }),
      create: async ({ data }: { data: { reason: string; xp: number } }) => {
        xpEvents.push(data);
        return {};
      },
    },
    question: {
      findMany: async ({ where }: { where?: { id?: { in: string[] }; kind?: string; flagged?: boolean; skillIds?: { hasSome: string[] } } }) => {
        if (where?.id?.in) return questions.filter((q) => where.id!.in.includes(q.id));
        // pickBossQuestions path — filter by kind + touched skills.
        return questions.filter(
          (q) =>
            (!where?.kind || q.kind === where.kind) &&
            (where?.flagged === undefined || q.flagged === where.flagged) &&
            (!where?.skillIds?.hasSome || q.skillIds.some((s) => where.skillIds!.hasSome.includes(s))),
        );
      },
      findUnique: async ({ where }: { where: { id: string } }) => questions.find((q) => q.id === where.id) ?? null,
      upsert: async () => ({ id: 'q-seed' }),
    },
    evidence: {
      findMany: async () => evidenceSkills.map((s) => ({ skillId: s })),
      create: async ({ data }: { data: unknown }) => {
        evidenceCreates.push(data);
        return {};
      },
    },
    skill: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }) },
    candidateSkillState: { findUnique: async () => null },
    attempt: {
      create: async ({ data }: { data: { kind: string; score: string } }) => ({ id: `att-${idSeq++}`, ...data }),
      findMany: async () => [],
    },
    streak: { findUnique: async () => null, upsert: async () => ({}) },
    remediationTask: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
  };
}

function fakeUsage() {
  return {
    assertCallAllowed: vi.fn(async () => {}),
    runWithUserLimit: async <T>(_u: string, fn: () => Promise<T>) => fn(),
  };
}
function fakeSensitivity() {
  return { assertAllowed: vi.fn(async () => {}) };
}

function build(opts: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(opts);
  const svc = new AssessmentsService(
    prisma as never,
    fakeUsage() as never,
    { get: () => null, set: () => {} } as never,
    fakeSensitivity() as never,
  );
  return { svc, prisma };
}

// XP required to be at exactly `level`. Any value >= xpForLevel(level) puts the
// user at `level` (until they cross into level+1).
function xpAtLevel(level: number): number {
  return xpForLevel(level) + 1;
}

afterEach(() => {
  vi.useRealTimers();
  chatStructuredMock.mockReset();
});

// -----------------------------------------------------------------------------
// B-2 invariant: expiresAt is computed server-side from startedAt + durationS.
// The client cannot influence this — the serializer never reads a client value.
// -----------------------------------------------------------------------------

describe('B-2: server-authoritative timer invariant', () => {
  it('serialized expiresAt = startedAt + durationS * 1000, from server state only', async () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 1800,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q1', 'q2', 'q3'],
        attemptIds: [],
      },
    ];
    const questions = [makeQ('q1', 'react'), makeQ('q2', 'react'), makeQ('q3', 'react')];
    // Freeze wall clock BEFORE any read so bossExpired uses the same instant
    // the serializer implicitly relies on.
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { svc } = build({ bosses, questions, xpTotal: xpAtLevel(10) });
    const task = await svc.getBossBattle('user-1', 'boss-1');
    expect(task.startedAt).toBe(startedAt.toISOString());
    expect(new Date(task.expiresAt).getTime()).toBe(startedAt.getTime() + 1800 * 1000);
    expect(task.durationS).toBe(1800);
    // MUTATION-SMOKE: change `new Date(startedAt.getTime() + durationS * 1000)`
    // in serializeBoss to `new Date(startedAt.getTime())` and this assertion
    // (expiresAt equals startedAt + 30 min) fails outright.
  });

  it('expiry transitions status to expired even when server time has advanced past deadline', async () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 60, // 1 min
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q1'],
        attemptIds: [],
      },
    ];
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { svc, prisma } = build({ bosses, questions: [makeQ('q1', 'react')], xpTotal: xpAtLevel(10) });
    // Still active before the deadline.
    let task = await svc.getBossBattle('user-1', 'boss-1');
    expect(task.status).toBe('active');

    // Fast-forward past the deadline. The stored row has NOT moved; the server
    // must compare startedAt + durationS against Date.now() — not against any
    // client-supplied "current time".
    vi.setSystemTime(new Date(startedAt.getTime() + 61 * 1000));
    task = await svc.getBossBattle('user-1', 'boss-1');
    expect(task.status).toBe('expired');
    // Persisted status flipped to 'expired' via a bossBattle.update call.
    expect(prisma.calls.updates.some((u) => u.data.status === 'expired')).toBe(true);
    expect(bosses[0]!.status).toBe('expired');
    // MUTATION-SMOKE: change `Date.now() - startedAt.getTime()` in bossExpired
    // to `-1` (or delete the update) and the status stays 'active' → fails.
  });
});

// -----------------------------------------------------------------------------
// Milestones fire in order + only once each.
// -----------------------------------------------------------------------------

describe('boss milestones L10, L25, L50, L75, L100', () => {
  it('milestone eligibility surfaces the lowest un-passed milestone the user has reached', async () => {
    const cases: Array<[number, number | null]> = [
      [0, null],
      [xpAtLevel(9), null], // still under L10
      [xpAtLevel(10), 10],
      [xpAtLevel(24), 10], // haven't reached L25 yet, L10 still available
      [xpAtLevel(25), 10], // L10 still open until we clear it
      [xpAtLevel(50), 10],
      [xpAtLevel(100), 10],
    ];
    for (const [totalXp, expected] of cases) {
      const { svc } = build({ xpTotal: totalXp });
      const el = await svc.getEligibleBossMilestone('user-1');
      expect([totalXp, el.milestone]).toEqual([totalXp, expected]);
    }
  });

  it('skips a milestone once its passed row exists (each fires only once)', async () => {
    // At level 25 with L10 already passed → next milestone is 25.
    const passed: BossRow[] = [
      {
        id: 'boss-old',
        userId: 'user-1',
        milestone: 10,
        startedAt: new Date('2025-01-01'),
        durationS: 1800,
        submittedAt: new Date('2025-01-01'),
        score: '0.9',
        status: 'passed',
        questionIds: [],
        attemptIds: [],
      },
    ];
    const { svc } = build({ bosses: passed, xpTotal: xpAtLevel(25) });
    const el = await svc.getEligibleBossMilestone('user-1');
    expect(el.milestone).toBe(25);
  });

  it('rejects startBossBattle for a milestone outside the fixed set', async () => {
    const { svc } = build({ xpTotal: xpAtLevel(100) });
    await expect(svc.startBossBattle('user-1', 42)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.startBossBattle('user-1', 5)).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION-SMOKE: replace BOSS_MILESTONES.includes(...) with `true` → both
    // 42 and 5 succeed past the guard (fail later on level check with a
    // different exception) but the assertion here loses. Keep guard.
  });

  it('rejects starting a milestone already passed', async () => {
    const bosses: BossRow[] = [
      {
        id: 'boss-old',
        userId: 'user-1',
        milestone: 10,
        startedAt: new Date('2025-01-01'),
        durationS: 1800,
        submittedAt: new Date('2025-01-01'),
        score: '0.9',
        status: 'passed',
        questionIds: [],
        attemptIds: [],
      },
    ];
    const questions = Array.from({ length: 3 }, (_, i) => makeQ(`q${i}`, 'react'));
    const { svc } = build({ bosses, questions, xpTotal: xpAtLevel(25), evidenceSkills: ['react'] });
    await expect(svc.startBossBattle('user-1', 10)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// -----------------------------------------------------------------------------
// Submission past expiry: rejection with consistent reason code.
// -----------------------------------------------------------------------------

describe('submitBossBattle post-expiry', () => {
  it('rejects a submit after the server-side deadline with "timer expired"', async () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 60,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q1'],
        attemptIds: [],
      },
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(startedAt.getTime() + 61 * 1000));
    const { svc, prisma } = build({ bosses, questions: [makeQ('q1', 'react')], xpTotal: xpAtLevel(10) });
    await expect(svc.submitBossBattle('user-1', 'boss-1', ['ans'])).rejects.toThrow(/timer expired/i);
    expect(bosses[0]!.status).toBe('expired');
    // Server also persisted the transition on the reject path.
    expect(prisma.calls.updates.some((u) => u.data.status === 'expired')).toBe(true);
    // MUTATION-SMOKE: remove the `bossExpired(...)` guard in submitBossBattle
    // and the submit succeeds past the deadline → this rejects assertion fails.
  });

  it('concurrent submits after expiry all get the same "timer expired" rejection', async () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 60,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q1'],
        attemptIds: [],
      },
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(startedAt.getTime() + 120 * 1000));
    const { svc } = build({ bosses, questions: [makeQ('q1', 'react')], xpTotal: xpAtLevel(10) });
    // Fire three concurrent submits.
    const results = await Promise.allSettled([
      svc.submitBossBattle('user-1', 'boss-1', ['a']),
      svc.submitBossBattle('user-1', 'boss-1', ['b']),
      svc.submitBossBattle('user-1', 'boss-1', ['c']),
    ]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      const reason = (r as PromiseRejectedResult).reason as Error;
      expect(reason.message).toMatch(/timer expired|Boss battle already/);
    }
  });

  it('client-supplied "current time" in the answers payload can NOT extend the deadline', async () => {
    // The submit signature is (userId, id, answers[]) — there is no client
    // time field. Any attempt to pass one is ignored by construction. We
    // verify by putting the server clock past the deadline and asserting
    // the submit rejects regardless of any argument-shaped attempt to lie.
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 60,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q1'],
        attemptIds: [],
      },
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(startedAt.getTime() + 5 * 60 * 1000));
    const { svc } = build({ bosses, questions: [makeQ('q1', 'react')], xpTotal: xpAtLevel(10) });
    // Even a payload masquerading as "still valid" cannot bypass server time.
    await expect(
      svc.submitBossBattle('user-1', 'boss-1', ['ans']),
    ).rejects.toThrow(/timer expired/i);
    // MUTATION-SMOKE: swap `this.bossExpired(row.startedAt, row.durationS)` for
    // a check on a client-supplied ts → this test still rejects only because
    // we did not supply one, but the invariant test above (getBossBattle
    // expiry) also fails. Two-test coverage catches either drift.
  });
});

// -----------------------------------------------------------------------------
// Sanity: getBossBattle returns 404 for a foreign user + serializer preserves
// milestone + question order.
// -----------------------------------------------------------------------------

describe('getBossBattle sanity', () => {
  it('404s a boss that belongs to another user (userId in the where clause)', async () => {
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'someone-else',
        milestone: 10,
        startedAt: new Date(),
        durationS: 1800,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: [],
        attemptIds: [],
      },
    ];
    const { svc } = build({ bosses });
    await expect(svc.getBossBattle('user-1', 'boss-1')).rejects.toBeInstanceOf(NotFoundException);
    // MUTATION-SMOKE: drop `userId` from the where clause on findFirst → this
    // 404 becomes a 200 leak of another user's row.
  });

  it('preserves question order from questionIds even if findMany returns them out of order', async () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    const bosses: BossRow[] = [
      {
        id: 'boss-1',
        userId: 'user-1',
        milestone: 10,
        startedAt,
        durationS: 1800,
        submittedAt: null,
        score: null,
        status: 'active',
        questionIds: ['q3', 'q1', 'q2'],
        attemptIds: [],
      },
    ];
    // Return questions in a DIFFERENT order to prove serializer sorts by questionIds.
    const questions = [makeQ('q1', 'react'), makeQ('q2', 'react'), makeQ('q3', 'react')];
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { svc } = build({ bosses, questions, xpTotal: xpAtLevel(10) });
    const task = await svc.getBossBattle('user-1', 'boss-1');
    expect(task.questions.map((q) => q.id)).toEqual(['q3', 'q1', 'q2']);
  });
});

// -----------------------------------------------------------------------------
// startBossBattle race guard: P2002 from the unique index maps to "already active".
// -----------------------------------------------------------------------------

describe('startBossBattle unique-index race', () => {
  beforeEach(() => {
    // No pre-existing active boss. The first create wins; the second must fail.
  });

  it('two concurrent starts: one wins, the other is rejected with "already active"', async () => {
    const questions = Array.from({ length: 3 }, (_, i) => makeQ(`q${i}`, 'react'));
    const { svc } = build({ questions, xpTotal: xpAtLevel(10), evidenceSkills: ['react'] });
    const results = await Promise.allSettled([
      svc.startBossBattle('user-1', 10),
      svc.startBossBattle('user-1', 10),
    ]);
    const kinds = results.map((r) => r.status);
    // Exactly one fulfilled + one rejected (order isn't guaranteed).
    expect(kinds.filter((k) => k === 'fulfilled')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'rejected')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect((rejected.reason as Error).message).toMatch(/already active/i);
    // MUTATION-SMOKE: strip the `if (code === 'P2002')` branch in
    // startBossBattle → the rejection message becomes 'unique' (the raw driver
    // error) instead of 'already active' → assertion fails.
  });
});
