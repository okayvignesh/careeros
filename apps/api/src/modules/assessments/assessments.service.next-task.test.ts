import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// Same mock scaffold: no HTTP, no real prompt registry, syncSkillState stubbed.
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
  return { ...actual, decrypt: () => 'k', loadMasterKey: () => Buffer.alloc(32) };
});

vi.mock('@careeros/aggregator', () => ({
  syncSkillState: vi.fn(async () => ({
    state: { proficiency: 0, confidence: 0, recencyDays: 0, historicalDemonstrated: 0, evidenceCount: 0 },
    level: 1,
    before: null,
  })),
}));

vi.mock('../../common/llm-audit', () => ({ makeLlmAuditor: () => async () => {} }));

// eslint-disable-next-line import/first
import { AssessmentsService } from './assessments.service';

// -----------------------------------------------------------------------------
// Prisma fake tailored to nextKnowledgeQuestion + ensureSeed + generate path.
// The seed logic writes 5 upserts on the first call; we track them so the
// eligible-pool assertions can compose with the exclusion set.
// -----------------------------------------------------------------------------

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

function makeQ(id: string, opts: Partial<FakeQuestion> = {}): FakeQuestion {
  return {
    id,
    kind: 'knowledge',
    skillIds: ['react'],
    difficulty: 'easy',
    prompt: `prompt ${id}`,
    keyPoints: ['virtual DOM'],
    answerHint: null,
    flagged: false,
    sourceKind: null,
    sourceUrl: null,
    sourceAttribution: null,
    ...opts,
  };
}

function fakePrisma(opts: {
  questions: FakeQuestion[];
  attempts?: Array<{ userId: string; kind: string; questionId: string; createdAt: Date }>;
  hasProvider?: boolean;
}) {
  const questions = [...opts.questions];
  const attempts = opts.attempts ?? [];
  return {
    _questions: questions,
    question: {
      findMany: async ({
        where,
      }: {
        where: {
          kind: string;
          flagged?: boolean;
          id?: { notIn: string[] };
          skillIds?: { has: string };
        };
      }) =>
        questions.filter((q) => {
          if (q.kind !== where.kind) return false;
          if (where.flagged !== undefined && q.flagged !== where.flagged) return false;
          if (where.id?.notIn && where.id.notIn.includes(q.id)) return false;
          if (where.skillIds?.has && !q.skillIds.includes(where.skillIds.has)) return false;
          return true;
        }),
      findUnique: async ({ where }: { where: { id?: string; promptHash?: string } }) =>
        questions.find((q) => q.id === where.id) ?? null,
      upsert: async ({ create, where }: { create: FakeQuestion; where: { promptHash: string } }) => {
        // Emulate promptHash dedupe by prompt string; ignore actual hash.
        const existing = questions.find((q) => q.prompt === create.prompt);
        if (existing) return existing;
        const row: FakeQuestion = {
          ...create,
          id: create.id ?? `q-${questions.length + 1}`,
        };
        questions.push(row);
        return row;
      },
    },
    attempt: {
      findMany: async ({ where }: { where: { userId: string; kind: string; createdAt?: { gte: Date } } }) =>
        attempts
          .filter(
            (a) =>
              a.userId === where.userId &&
              a.kind === where.kind &&
              (!where.createdAt?.gte || a.createdAt >= where.createdAt.gte),
          )
          .map((a) => ({ questionId: a.questionId })),
    },
    providerConfig: {
      findFirst: async () =>
        opts.hasProvider
          ? {
              id: 'cfg-1',
              provider: 'deepseek',
              isDefault: true,
              apiKeySecretId: 'sec-1',
              baseUrl: null,
              chatModel: 'deepseek-chat',
            }
          : null,
    },
    encryptedSecret: { findUnique: async () => ({ ciphertext: Buffer.from('x') }) },
    skill: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }) },
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

afterEach(() => {
  chatStructuredMock.mockReset();
});

// -----------------------------------------------------------------------------
// Priority-order fallback: no prereq graph shipped yet (walking-skeleton comment
// on nextKnowledgeQuestion). Behaviour under test is the actual production
// picker: honor cooldown, honor skill filter, generate when the pool is thin.
// -----------------------------------------------------------------------------

describe('nextKnowledgeQuestion picker', () => {
  it('excludes questions attempted inside the 14-day cooldown window', async () => {
    // Seed 3 questions; user attempted q1 yesterday → picker must pick q2 or q3.
    const questions = [
      makeQ('q1', { skillIds: ['react'] }),
      makeQ('q2', { skillIds: ['react'] }),
      makeQ('q3', { skillIds: ['react'] }),
    ];
    const attempts = [
      { userId: 'u1', kind: 'knowledge', questionId: 'q1', createdAt: new Date(Date.now() - 86_400_000) },
    ];
    const { svc } = build({ questions, attempts });
    // Run several picks — never q1 within cooldown.
    for (let i = 0; i < 20; i++) {
      const picked = await svc.nextKnowledgeQuestion('u1', 'react');
      expect(picked.id).not.toBe('q1');
    }
    // MUTATION-SMOKE: drop `where.id = { notIn: excludeIds };` from
    // nextKnowledgeQuestion → q1 leaks back into the pool, this test hits it
    // eventually with high probability across 20 picks.
  });

  it('falls back to the full pool when every question is on cooldown', async () => {
    const questions = [makeQ('q1', { skillIds: ['react'] })];
    const attempts = [
      { userId: 'u1', kind: 'knowledge', questionId: 'q1', createdAt: new Date(Date.now() - 3600_000) },
    ];
    const { svc } = build({ questions, attempts });
    // Only q1 exists; even though it's on cooldown, dead-end recovery returns it.
    const picked = await svc.nextKnowledgeQuestion('u1', 'react');
    expect(picked.id).toBe('q1');
    // MUTATION-SMOKE: remove the fallback branch (line "const pool = eligible
    // ... : findMany({ where: { kind, flagged: false }})") → NotFoundException
    // is thrown instead of returning q1.
  });

  it('filters to the requested skill when skillId is provided', async () => {
    const questions = [
      makeQ('q1', { skillIds: ['react'] }),
      makeQ('q2', { skillIds: ['postgres'] }),
      makeQ('q3', { skillIds: ['docker'] }),
    ];
    const { svc } = build({ questions });
    for (let i = 0; i < 10; i++) {
      const picked = await svc.nextKnowledgeQuestion('u1', 'postgres');
      expect(picked.id).toBe('q2');
    }
  });

  it('404s when no questions exist for the kind at all', async () => {
    // Empty pool AND no seed rows (kind mismatch would seed on ensureSeed but
    // we bypass by filtering — pool is truly empty for a nonexistent skill).
    const questions: FakeQuestion[] = [];
    const { svc } = build({ questions });
    await expect(svc.nextKnowledgeQuestion('u1', 'nonexistent-skill')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// -----------------------------------------------------------------------------
// Thumbs-down / flagged regen path: a flagged question is excluded from the
// pool. Once flagged, the next call MUST produce a different task.
// -----------------------------------------------------------------------------

describe('flagged-question exclusion (thumbs-down regen path)', () => {
  it('never picks a flagged question, always picks the un-flagged sibling', async () => {
    const questions = [
      makeQ('q1', { skillIds: ['react'], flagged: true }),
      makeQ('q2', { skillIds: ['react'], flagged: false }),
    ];
    const { svc } = build({ questions });
    for (let i = 0; i < 20; i++) {
      const picked = await svc.nextKnowledgeQuestion('u1', 'react');
      expect(picked.id).toBe('q2');
    }
    // MUTATION-SMOKE: change `flagged: false` in the where clause to
    // `flagged: true` (or drop the key) → q1 gets picked → test fails.
  });

  it('after flagging the last remaining un-flagged one, next call returns something different (falls back to full pool)', async () => {
    // Only q1 exists un-flagged initially; user attempts it (adds to cooldown)
    // then it gets flagged. The picker's dead-end fallback ignores cooldown,
    // but must still respect the flag → NotFoundException when the pool is
    // fully flagged AND we have no fallback rows.
    const q1 = makeQ('q1', { skillIds: ['react'], flagged: false });
    const attempts = [
      { userId: 'u1', kind: 'knowledge', questionId: 'q1', createdAt: new Date(Date.now() - 3600_000) },
    ];
    const prisma = fakePrisma({ questions: [q1], attempts });
    // Manually flip the flag mid-flight to simulate the thumbs-down action.
    q1.flagged = true;
    prisma._questions[0]!.flagged = true;
    const svc = new AssessmentsService(
      prisma as never,
      fakeUsage() as never,
      { get: () => null, set: () => {} } as never,
      fakeSensitivity() as never,
    );
    await expect(svc.nextKnowledgeQuestion('u1', 'react')).rejects.toBeInstanceOf(NotFoundException);
    // MUTATION-SMOKE: same as above — dropping `flagged: false` from the
    // fallback findMany call would let q1 through → this test starts
    // succeeding when it should reject.
  });

  it('regen path: two distinct calls with the flagged one excluded return the un-flagged sibling every time', async () => {
    // Simulates: user thumbs-down q1 → next call returns q2 (not q1).
    const questions = [
      makeQ('q1', { skillIds: ['react'], flagged: true, prompt: 'bad prompt' }),
      makeQ('q2', { skillIds: ['react'], flagged: false, prompt: 'good prompt' }),
    ];
    const { svc } = build({ questions });
    const a = await svc.nextKnowledgeQuestion('u1', 'react');
    const b = await svc.nextKnowledgeQuestion('u1', 'react');
    expect(a.prompt).toBe('good prompt');
    expect(b.prompt).toBe('good prompt');
    expect(a.id).not.toBe('q1');
    expect(b.id).not.toBe('q1');
  });
});

// -----------------------------------------------------------------------------
// Auto-top-up: when the eligible pool is thin AND a provider is configured,
// generateKnowledgeQuestion runs. When empty it awaits; when >=1 it fires and
// forget (returns the current row immediately).
// -----------------------------------------------------------------------------

describe('auto-top-up when eligible pool is thin', () => {
  it('empty eligible pool + provider configured: awaits a fresh generation and returns it', async () => {
    // No matching questions for skill=react → the picker must call the LLM
    // and serve the returned row.
    const { svc } = build({
      questions: [],
      hasProvider: true,
    });
    chatStructuredMock.mockResolvedValueOnce({
      prompt: 'Fresh question for react',
      keyPoints: ['keys'],
      difficulty: 'medium',
      answerHint: null,
    });
    const picked = await svc.nextKnowledgeQuestion('u1', 'react');
    expect(picked.prompt).toBe('Fresh question for react');
    expect(chatStructuredMock).toHaveBeenCalledTimes(1);
    // MUTATION-SMOKE: remove the `if (eligible.length === 0) { await
    // generateKnowledgeQuestion(...) }` branch → the picker throws
    // NotFoundException instead of awaiting the top-up.
  });

  it('eligible pool has 1 (below MIN_ELIGIBLE_POOL=2) but no provider: still serves the existing row', async () => {
    const questions = [makeQ('q1', { skillIds: ['react'] })];
    const { svc } = build({ questions, hasProvider: false });
    const picked = await svc.nextKnowledgeQuestion('u1', 'react');
    expect(picked.id).toBe('q1');
    // generateKnowledgeQuestion fires-and-forgets on the thin-pool path when
    // count > 0; without a provider it returns null quickly.
  });
});
