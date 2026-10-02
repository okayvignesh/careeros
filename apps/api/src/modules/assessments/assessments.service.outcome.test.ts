import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xpFor } from '@careeros/shared';

// -----------------------------------------------------------------------------
// Equivalence coverage for the extracted `recordAttemptOutcome` ritual. Every
// assessment type must produce the SAME shared side effects: one attempt row,
// one evidence row per mapped skill (same signal/weightHint/sourceRef), a
// syncSkillState call per skill, remediation reconciliation, one XP event, and
// an AttemptResult carrying xp/level/streak/skillDeltas. Boss-battle is covered
// by its own suite (it batches attempts and settles XP once for the encounter).
// -----------------------------------------------------------------------------

const { chatStructuredMock, runSandboxedMock } = vi.hoisted(() => ({
  chatStructuredMock: vi.fn(),
  runSandboxedMock: vi.fn(),
}));

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
  return { ...actual, decrypt: () => 'fake-api-key', loadMasterKey: () => Buffer.alloc(32) };
});

vi.mock('@careeros/aggregator', () => ({
  syncSkillState: vi.fn(async () => ({
    state: { proficiency: 0.5, confidence: 0.5, recencyDays: 0, historicalDemonstrated: 1, evidenceCount: 1 },
    level: 2,
    before: null,
  })),
}));

vi.mock('@careeros/sandbox', () => ({
  runSandboxed: (...args: unknown[]) => runSandboxedMock(...args),
}));

vi.mock('../../common/llm-audit', () => ({ makeLlmAuditor: () => async () => {} }));

// eslint-disable-next-line import/first
import { syncSkillState } from '@careeros/aggregator';
// eslint-disable-next-line import/first
import { AssessmentsService } from './assessments.service';

const syncSkillStateMock = vi.mocked(syncSkillState);

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

interface EvidenceRow {
  signal: string;
  weightHint: string;
  sourceRef: { kind: string; id: string } & Record<string, unknown>;
}

function question(overrides: Partial<FakeQuestion>): FakeQuestion {
  return {
    id: 'q1',
    kind: 'knowledge',
    skillIds: ['react'],
    difficulty: 'easy',
    prompt: 'prompt',
    keyPoints: [],
    answerHint: null,
    flagged: false,
    sourceKind: null,
    sourceUrl: null,
    sourceAttribution: null,
    ...overrides,
  };
}

function fakePrisma(q: FakeQuestion, recentAttempts: unknown[] = []) {
  const attempts: Array<{ id: string; kind: string; score: string; gradingJson: unknown }> = [];
  const xpEvents: Array<{ reason: string; xp: number; attemptId?: string }> = [];
  const evidence: EvidenceRow[] = [];
  const remediationClosures: unknown[] = [];
  const remediationCreates: Array<{ reason: string; sourceAttemptIds: string[] }> = [];
  let nextId = 1;
  return {
    calls: { attempts, xpEvents, evidence, remediationClosures, remediationCreates },
    question: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === q.id ? q : null),
      findMany: async () => [q],
      upsert: async ({ create }: { create: FakeQuestion }) => ({ ...create, id: 'seed' }),
    },
    providerConfig: {
      findFirst: async () => ({
        id: 'cfg-1',
        provider: 'deepseek',
        isDefault: true,
        apiKeySecretId: 'sec-1',
        baseUrl: null,
        chatModel: 'deepseek-chat',
      }),
    },
    encryptedSecret: { findUnique: async () => ({ id: 'sec-1', ciphertext: Buffer.from('x') }) },
    attempt: {
      create: async ({ data }: { data: { kind: string; score: string; gradingJson: unknown } }) => {
        const id = `att-${nextId++}`;
        attempts.push({ id, kind: data.kind, score: data.score, gradingJson: data.gradingJson });
        return { id };
      },
      findMany: async () => recentAttempts,
      count: async () => attempts.length,
    },
    skill: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }),
      findMany: async () => [],
    },
    candidateSkillState: { findUnique: async () => null },
    evidence: {
      create: async ({ data }: { data: EvidenceRow }) => {
        evidence.push(data);
        return {};
      },
    },
    xpEvent: {
      create: async ({ data }: { data: { reason: string; xp: number; attemptId?: string } }) => {
        xpEvents.push({
          reason: data.reason,
          xp: data.xp,
          ...(data.attemptId !== undefined ? { attemptId: data.attemptId } : {}),
        });
        return {};
      },
      aggregate: async () => ({ _sum: { xp: xpEvents.reduce((a, e) => a + e.xp, 0) } }),
    },
    streak: { findUnique: async () => null, upsert: async () => ({}) },
    remediationTask: {
      updateMany: async (args: unknown) => {
        remediationClosures.push(args);
        return { count: 0 };
      },
      create: async ({ data }: { data: { reason: string; sourceAttemptIds: string[] } }) => {
        remediationCreates.push(data);
        return {};
      },
    },
  };
}

function build(q: FakeQuestion, recentAttempts: unknown[] = []) {
  const prisma = fakePrisma(q, recentAttempts);
  const svc = new AssessmentsService(
    prisma as never,
    {
      assertCallAllowed: vi.fn(async () => {}),
      runWithUserLimit: async <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
    } as never,
    { get: () => null, set: () => {} } as never,
    { assertAllowed: vi.fn(async () => {}) } as never,
  );
  return { svc, prisma };
}

/**
 * Assert the invariants every single-attempt outcome shares. `score` is the
 * grading score the type produced; everything else is derived from it.
 */
function assertSharedRitual(opts: {
  prisma: ReturnType<typeof fakePrisma>;
  attemptKind: string;
  xpKind: Parameters<typeof xpFor>[0];
  score: number;
  skillIds: string[];
}) {
  const { prisma, score, skillIds } = opts;
  expect(prisma.calls.attempts).toHaveLength(1);
  const attempt = prisma.calls.attempts[0]!;
  expect(attempt.kind).toBe(opts.attemptKind);
  expect(attempt.score).toBe(score.toFixed(3));

  expect(prisma.calls.evidence).toHaveLength(skillIds.length);
  for (const ev of prisma.calls.evidence) {
    expect(ev.signal).toBe(score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction');
    expect(ev.weightHint).toBe(score.toFixed(3));
    expect(ev.sourceRef).toEqual({ kind: 'attempt', id: attempt.id });
  }
  expect(syncSkillStateMock).toHaveBeenCalledTimes(skillIds.length);

  const xpEvent = prisma.calls.xpEvents.at(-1)!;
  expect(xpEvent.reason).toBe(`attempt:${opts.attemptKind}`);
  expect(xpEvent.xp).toBe(xpFor(opts.xpKind, score));
  expect(xpEvent.attemptId).toBe(attempt.id);

  // A solid pass auto-closes any open remediation; a fail with no history does
  // not open one.
  if (score >= 0.7) expect(prisma.calls.remediationClosures).toHaveLength(skillIds.length);
}

beforeEach(() => {
  chatStructuredMock.mockReset();
  runSandboxedMock.mockReset();
  syncSkillStateMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordAttemptOutcome — shared ritual across assessment types', () => {
  it('knowledge: attempt + evidence + sync + xp + result', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.9,
      hits: ['virtual DOM'],
      misses: ['keys'],
      reasoning: 'solid',
    });
    const q = question({ skillIds: ['react', 'node-js'] });
    const { svc, prisma } = build(q);
    const result = await svc.gradeKnowledgeAttempt('u1', { questionId: 'q1', answer: 'answer' });
    assertSharedRitual({ prisma, attemptKind: 'knowledge', xpKind: 'knowledge', score: 0.9, skillIds: q.skillIds });
    expect(result.hits).toEqual(['virtual DOM']);
    expect(result.skillDeltas).toHaveLength(2);
  });

  it('code-review: attempt + evidence + sync + xp + result', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.75,
      precision: 0.75,
      recall: 0.75,
      hits: ['off-by-one'],
      misses: ['null-deref'],
      falsePositives: [],
      reasoning: 'ok',
    });
    const q = question({ id: 'cr1', kind: 'code-review', skillIds: ['typescript'], keyPoints: ['off-by-one'] });
    const { svc, prisma } = build(q);
    await svc.gradeCodeReviewAttempt('u1', { questionId: 'cr1', findings: ['loop bound'] });
    assertSharedRitual({ prisma, attemptKind: 'code-review', xpKind: 'code-review', score: 0.75, skillIds: q.skillIds });
  });

  it('system-design: attempt + evidence + sync + xp + result', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.8,
      dimensions: [{ dimensionId: 'requirements', score: 5, notes: '' }],
      reasoning: 'good',
    });
    const q = question({
      id: 'sd1',
      kind: 'system-design',
      skillIds: ['system-design'],
      keyPoints: ['requirements'],
      answerHint: JSON.stringify({ constraints: ['low latency'] }),
    });
    const { svc, prisma } = build(q);
    await svc.gradeSystemDesignAttempt('u1', { questionId: 'sd1', design: 'API + DB' });
    assertSharedRitual({ prisma, attemptKind: 'system-design', xpKind: 'system-design', score: 0.8, skillIds: q.skillIds });
  });

  it('debugging: attempt + evidence + sync + xp + result', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.85,
      correctness: 0.9,
      minimality: 0.8,
      reasoning: 'tight',
    });
    const q = question({
      id: 'db1',
      kind: 'debugging',
      skillIds: ['debugging'],
      prompt: 'broken',
      keyPoints: ['off by one'],
      answerHint: JSON.stringify({ description: 'd', hint: 'h' }),
    });
    const { svc, prisma } = build(q);
    await svc.gradeDebuggingAttempt('u1', { questionId: 'db1', fix: 'i < n' });
    assertSharedRitual({ prisma, attemptKind: 'debugging', xpKind: 'debugging', score: 0.85, skillIds: q.skillIds });
  });

  it('mock-interview: attempt + evidence + sync + xp + result', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.8,
      questions: [
        { index: 0, score: 0.9, hits: [], misses: [], notes: '' },
        { index: 1, score: 0.8, hits: [], misses: [], notes: '' },
        { index: 2, score: 0.7, hits: [], misses: [], notes: '' },
      ],
      reasoning: 'mid',
    });
    const q = question({
      id: 'mi1',
      kind: 'mock-interview',
      skillIds: ['mock-interview'],
      answerHint: JSON.stringify({
        scenario: 's',
        questions: [
          { kind: 'technical', prompt: 'a', keyPoints: ['x'] },
          { kind: 'technical', prompt: 'b', keyPoints: ['y'] },
          { kind: 'behavioral', prompt: 'c', keyPoints: ['z'] },
        ],
      }),
    });
    const { svc, prisma } = build(q);
    await svc.gradeMockInterviewAttempt('u1', { questionId: 'mi1', answers: ['1', '2', '3'] });
    assertSharedRitual({ prisma, attemptKind: 'mock-interview', xpKind: 'mock-interview', score: 0.8, skillIds: q.skillIds });
  });

  it('build/sandbox: attempt + evidence + sync + xp + result', async () => {
    runSandboxedMock.mockResolvedValueOnce({
      status: 'ok',
      stdout: 'PASS a\nPASS b\n',
      stderr: '',
      exitCode: 0,
      wallTimeMs: 5,
      containerId: 'c',
    });
    const q = question({
      id: 'b1',
      kind: 'build',
      skillIds: ['node-js'],
      prompt: 'desc',
      keyPoints: ['tests'],
      answerHint: JSON.stringify({ language: 'node', title: 't', starter: '', timeoutMs: 5000 }),
    });
    const { svc, prisma } = build(q);
    await svc.gradeBuildAttempt('u1', { questionId: 'b1', code: 'code' });
    assertSharedRitual({ prisma, attemptKind: 'build', xpKind: 'build', score: 1, skillIds: q.skillIds });
  });
});

describe('recordAttemptOutcome — remediation reconciliation', () => {
  it('a passing attempt closes an open remediation task', async () => {
    chatStructuredMock.mockResolvedValueOnce({ score: 1, hits: ['k'], misses: [], reasoning: 'pass' });
    const q = question({ skillIds: ['react'] });
    const { svc, prisma } = build(q);
    await svc.gradeKnowledgeAttempt('u1', { questionId: 'q1', answer: 'k' });
    expect(prisma.calls.remediationClosures).toHaveLength(1);
    expect(prisma.calls.remediationClosures[0]).toMatchObject({
      where: { userId: 'u1', skillId: 'react', status: 'open' },
      data: { status: 'closed' },
    });
    expect(prisma.calls.remediationCreates).toHaveLength(0);
  });

  it('three consecutive recent fails open one remediation task per skill', async () => {
    chatStructuredMock.mockResolvedValueOnce({ score: 0.2, hits: [], misses: ['k'], reasoning: 'fail' });
    const q = question({ skillIds: ['react'] });
    const recent = [0, 1, 2].map((i) => ({
      id: `old-${i}`,
      score: '0.100',
      createdAt: new Date(Date.now() - i * 3_600_000),
    }));
    const { svc, prisma } = build(q, recent);
    await svc.gradeKnowledgeAttempt('u1', { questionId: 'q1', answer: 'nope' });
    expect(prisma.calls.remediationClosures).toHaveLength(0);
    expect(prisma.calls.remediationCreates).toHaveLength(1);
    expect(prisma.calls.remediationCreates[0]!.reason).toMatch(/Failed 3 times in a row/);
    expect(prisma.calls.remediationCreates[0]!.sourceAttemptIds).toEqual(['old-0', 'old-1', 'old-2']);
  });
});
