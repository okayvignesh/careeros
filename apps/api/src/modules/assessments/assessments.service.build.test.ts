import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same mock scaffold as the sibling grading tests: no HTTP, no real prompt
// registry, syncSkillState stubbed. The sandbox call is injected via the
// `runSandbox` field seam on AssessmentsService (set in each test).

vi.mock('@careeros/ai', async () => {
  const actual = await vi.importActual<typeof import('@careeros/ai')>('@careeros/ai');
  class FakeDeepSeekProvider {
    constructor(public readonly cfg: unknown) {}
    async chatStructured() {
      return {};
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
    state: { proficiency: 0.5, confidence: 0.5, recencyDays: 0, historicalDemonstrated: 1, evidenceCount: 1 },
    level: 2,
    before: null,
  })),
}));

vi.mock('../../common/llm-audit', () => ({ makeLlmAuditor: () => async () => {} }));

// Mock the sandbox module itself so the import does not pull in Docker helpers
// transitively, and so the default `runSandbox` field on the service points at
// a vi.fn() we can inspect even when a test forgets to replace it.
const { runSandboxedMock } = vi.hoisted(() => ({ runSandboxedMock: vi.fn() }));
vi.mock('@careeros/sandbox', () => ({
  runSandboxed: (...args: unknown[]) => runSandboxedMock(...args),
}));

// eslint-disable-next-line import/first
import { AssessmentsService, scoreBuildRun } from './assessments.service';

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

function makeBuildQ(overrides: Partial<FakeQuestion> = {}): FakeQuestion {
  return {
    id: 'b1',
    kind: 'build',
    skillIds: ['node-js'],
    difficulty: 'easy',
    prompt: 'Implement sum(a,b)',
    keyPoints: [
      [
        "const assert = (c, n) => console.log((c ? 'PASS ' : 'FAIL ') + n);",
        "assert(sum(1,2) === 3, 'adds');",
        "assert(sum(0,0) === 0, 'zeros');",
      ].join('\n'),
    ],
    answerHint: JSON.stringify({
      language: 'node',
      title: 'sum',
      starter: 'function sum(a, b) { /* edit */ }\n',
      timeoutMs: 5000,
    }),
    flagged: false,
    sourceKind: null,
    sourceUrl: null,
    sourceAttribution: null,
    ...overrides,
  };
}

function fakePrisma(question: FakeQuestion) {
  const attempts: Array<{ id: string; kind: string; score: string; gradingJson: unknown; answerJson: unknown }> = [];
  const xpEvents: Array<{ reason: string; xp: number }> = [];
  const evidence: unknown[] = [];
  let nextId = 1;
  return {
    calls: { attempts, xpEvents, evidence },
    question: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === question.id ? question : null,
      findMany: async () => [question],
      upsert: async ({ create }: { create: FakeQuestion }) => ({ ...create, id: 'seed' }),
    },
    providerConfig: { findFirst: async () => null },
    encryptedSecret: { findUnique: async () => null },
    attempt: {
      create: async ({ data }: { data: { kind: string; score: string; gradingJson: unknown; answerJson: unknown } }) => {
        const id = `att-${nextId++}`;
        attempts.push({ id, kind: data.kind, score: data.score, gradingJson: data.gradingJson, answerJson: data.answerJson });
        return { id };
      },
      findMany: async () => [],
      count: async () => attempts.length,
    },
    skill: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }),
    },
    candidateSkillState: { findUnique: async () => null },
    evidence: {
      create: async ({ data }: { data: unknown }) => {
        evidence.push(data);
        return {};
      },
    },
    xpEvent: {
      create: async ({ data }: { data: { reason: string; xp: number } }) => {
        xpEvents.push({ reason: data.reason, xp: data.xp });
        return {};
      },
      aggregate: async () => ({ _sum: { xp: xpEvents.reduce((a, e) => a + e.xp, 0) } }),
    },
    streak: { findUnique: async () => null, upsert: async () => ({}) },
    remediationTask: {
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
  };
}

function fakeUsage() {
  return {
    assertCallAllowed: vi.fn(async () => {}),
    runWithUserLimit: async <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
  };
}

function fakeSensitivity() {
  return { assertAllowed: vi.fn(async () => {}) };
}

function build(question: FakeQuestion) {
  const prisma = fakePrisma(question);
  const svc = new AssessmentsService(
    prisma as never,
    fakeUsage() as never,
    { get: () => null, set: () => {} } as never,
    fakeSensitivity() as never,
  );
  return { svc, prisma };
}

beforeEach(() => {
  runSandboxedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('gradeBuildAttempt (C-P2.4 sandbox consumer wire)', () => {
  it('invokes the sandbox with starter + user code + tests concatenated', async () => {
    runSandboxedMock.mockResolvedValueOnce({
      status: 'ok',
      stdout: 'PASS adds\nPASS zeros\n',
      stderr: '',
      exitCode: 0,
      wallTimeMs: 42,
      containerId: 'c-1',
    });
    const q = makeBuildQ();
    const { svc } = build(q);
    const r = await svc.gradeBuildAttempt('u1', { questionId: 'b1', code: 'function sum(a,b){return a+b;}' });

    // The sandbox was called exactly once with language from the question meta
    // and a program that includes starter, user code, and tests.
    expect(runSandboxedMock).toHaveBeenCalledTimes(1);
    const callArgs = runSandboxedMock.mock.calls[0]![0] as { language: string; code: string; timeoutMs: number };
    expect(callArgs.language).toBe('node');
    expect(callArgs.timeoutMs).toBe(5000);
    expect(callArgs.code).toContain('function sum(a, b)'); // starter
    expect(callArgs.code).toContain('function sum(a,b){return a+b;}'); // user
    expect(callArgs.code).toContain("assert(sum(1,2) === 3, 'adds');"); // tests
    // Both tests passed → score 1, xp = 300 * 1 = 300.
    expect(r.score).toBe(1);
    expect(r.xpAwarded).toBe(300);
    expect(r.hits).toEqual(['pass: adds', 'pass: zeros']);
    expect(r.misses).toEqual([]);
  });

  it('persists sandbox metadata + per-test tallies onto the attempt', async () => {
    runSandboxedMock.mockResolvedValueOnce({
      status: 'ok',
      stdout: 'PASS adds\nFAIL zeros\n',
      stderr: '',
      exitCode: 0,
      wallTimeMs: 77,
      containerId: 'c-2',
    });
    const { svc, prisma } = build(makeBuildQ());
    const r = await svc.gradeBuildAttempt('u1', { questionId: 'b1', code: 'function sum(a,b){return a+1;}' });

    expect(r.score).toBeCloseTo(0.5, 3);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({
      passed: 1,
      failed: 1,
      total: 2,
      sandbox: { status: 'ok', exitCode: 0, wallTimeMs: 77 },
      grader: 'sandbox',
    });
    expect(prisma.calls.attempts[0]!.answerJson).toMatchObject({ code: 'function sum(a,b){return a+1;}' });
    // Evidence row got weightHint = score and the sandbox status propagated.
    expect(prisma.calls.evidence[0]).toMatchObject({
      weightHint: '0.500',
      detail: { passed: 1, failed: 1, total: 2, sandboxStatus: 'ok' },
    });
  });

  it('sandbox timeout → score 0 with reason surfaced', async () => {
    runSandboxedMock.mockResolvedValueOnce({
      status: 'timeout',
      stdout: 'PASS adds\n',
      stderr: '',
      exitCode: null,
      wallTimeMs: 10_000,
      containerId: 'c-3',
      killedBy: 'wallclock',
    });
    const { svc, prisma } = build(makeBuildQ());
    const r = await svc.gradeBuildAttempt('u1', { questionId: 'b1', code: 'while(true){}' });
    expect(r.score).toBe(0);
    expect(r.reasoning).toContain('timeout');
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({
      sandbox: { status: 'timeout', killedBy: 'wallclock' },
      total: 0,
    });
  });

  it('sandbox paused (kill-switch) → score 0, operator reason', async () => {
    runSandboxedMock.mockResolvedValueOnce({
      status: 'paused',
      stdout: '',
      stderr: 'sandbox is paused by operator',
      exitCode: null,
      wallTimeMs: 0,
      containerId: '',
      killedBy: 'operator',
    });
    const { svc } = build(makeBuildQ());
    const r = await svc.gradeBuildAttempt('u1', { questionId: 'b1', code: 'function sum(a,b){return a+b}' });
    expect(r.score).toBe(0);
    expect(r.reasoning).toContain('paused');
    expect(r.reasoning).toContain('operator');
  });

  it('rejects missing code', async () => {
    const { svc } = build(makeBuildQ());
    await expect(svc.gradeBuildAttempt('u1', { questionId: 'b1', code: '   ' })).rejects.toThrow(/code is required/);
    expect(runSandboxedMock).not.toHaveBeenCalled();
  });

  it('rejects when the question is the wrong kind', async () => {
    const q = makeBuildQ({ id: 'wrong', kind: 'knowledge' });
    const { svc } = build(q);
    await expect(svc.gradeBuildAttempt('u1', { questionId: 'wrong', code: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('scoreBuildRun parser', () => {
  it('counts PASS and FAIL lines, computes score = passed / total', () => {
    const r = scoreBuildRun({
      status: 'ok',
      stdout: 'noise\nPASS a\nFAIL b\nPASS c\n',
      stderr: '',
      exitCode: 0,
      wallTimeMs: 1,
      containerId: 'x',
    });
    expect(r.total).toBe(3);
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.score).toBeCloseTo(2 / 3, 5);
    expect(r.passedNames).toEqual(['a', 'c']);
    expect(r.failedNames).toEqual(['b']);
  });

  it('zero recognised lines → score 0 with explanatory reason', () => {
    const r = scoreBuildRun({
      status: 'ok',
      stdout: 'no markers at all\n',
      stderr: '',
      exitCode: 0,
      wallTimeMs: 1,
      containerId: 'x',
    });
    expect(r.score).toBe(0);
    expect(r.total).toBe(0);
    expect(r.reasoning).toMatch(/no PASS\/FAIL/i);
  });
});
