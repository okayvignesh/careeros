import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -----------------------------------------------------------------------------
// Module mocks. Kept at the top so the SUT sees the stubs at import time.
// - @careeros/ai: real DeepSeekProvider hits the network on construction (DNS
//   allowlist check) — swap in a class with a mockable chatStructured.
// - @careeros/secrets: decrypt is called with a real ciphertext buffer; return
//   a fixed api key so the service reaches the provider stub.
// - ../../common/aggregate-skill: pure DB-touching aggregator. Not what we're
//   testing here — the grader path is. Return a stable delta.
// - ../../common/llm-audit: makeLlmAuditor writes to prisma.llmCall; noop.
// -----------------------------------------------------------------------------

// `vi.hoisted` runs before every `vi.mock` factory so shared spies survive
// the hoisting reorder without breaking closure semantics.
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
    // renderPrompt reaches into the registry (validates prompt id exists). Stub
    // with a permissive shape so the service does not have to know real ids.
    renderPrompt: (_id: string, _vars: Record<string, string>) => ({
      system: 'sys',
      user: 'usr',
      schema: (actual as unknown as { z?: unknown }).z ?? {},
    }),
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

vi.mock('../../common/llm-audit', () => ({
  makeLlmAuditor: () => async () => {},
}));

// eslint-disable-next-line import/first
import { AssessmentsService } from './assessments.service';

// -----------------------------------------------------------------------------
// Minimal Prisma fake. Only the methods the grading paths touch. Every write
// is recorded so the assertions can inspect what landed.
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

function fakePrisma(opts: {
  hasProvider?: boolean;
  providerName?: string;
  question: FakeQuestion;
}) {
  const attempts: Array<{ id: string; kind: string; score: string; gradingJson: unknown }> = [];
  const xpEvents: Array<{ reason: string; xp: number; attemptId?: string | null }> = [];
  const evidence: unknown[] = [];
  const remediationCreates: unknown[] = [];
  const remediationClosures: unknown[] = [];
  let nextId = 1;

  return {
    calls: { attempts, xpEvents, evidence, remediationCreates, remediationClosures },
    question: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === opts.question.id ? opts.question : null,
      findMany: async () => [opts.question],
      upsert: async ({ create }: { create: FakeQuestion }) => ({ ...create, id: 'q-seed' }),
    },
    providerConfig: {
      findFirst: async () =>
        opts.hasProvider
          ? {
              id: 'cfg-1',
              provider: opts.providerName ?? 'deepseek',
              isDefault: true,
              apiKeySecretId: 'sec-1',
              baseUrl: null,
              chatModel: 'deepseek-chat',
            }
          : null,
    },
    encryptedSecret: {
      findUnique: async () => ({ id: 'sec-1', ciphertext: Buffer.from('x') }),
    },
    attempt: {
      create: async ({ data }: { data: { kind: string; score: string; gradingJson: unknown } }) => {
        const id = `att-${nextId++}`;
        attempts.push({ id, kind: data.kind, score: data.score, gradingJson: data.gradingJson });
        return { id };
      },
      findMany: async () => [],
      count: async () => attempts.length,
    },
    skill: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }),
    },
    candidateSkillState: {
      findUnique: async () => null,
    },
    evidence: {
      create: async ({ data }: { data: unknown }) => {
        evidence.push(data);
        return {};
      },
    },
    xpEvent: {
      create: async ({ data }: { data: { reason: string; xp: number; attemptId?: string | null } }) => {
        xpEvents.push({ reason: data.reason, xp: data.xp, ...(data.attemptId !== undefined && { attemptId: data.attemptId }) });
        return {};
      },
      aggregate: async () => ({ _sum: { xp: xpEvents.reduce((a, e) => a + e.xp, 0) } }),
    },
    streak: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    remediationTask: {
      updateMany: async (args: unknown) => {
        remediationClosures.push(args);
        return { count: 0 };
      },
      create: async ({ data }: { data: unknown }) => {
        remediationCreates.push(data);
        return {};
      },
    },
  };
}

// UsageService + SensitivityGateService are behavioural — the service calls
// `assertCallAllowed`, `assertAllowed`, and `runWithUserLimit(userId, fn)`.
function fakeUsage() {
  return {
    assertCallAllowed: vi.fn(async () => {}),
    runWithUserLimit: async <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
  };
}

function fakeSensitivity() {
  return { assertAllowed: vi.fn(async () => {}) };
}

function build(opts: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(opts);
  const usage = fakeUsage();
  const sensitivity = fakeSensitivity();
  const svc = new AssessmentsService(
    prisma as never,
    usage as never,
    { get: () => null, set: () => {} } as never,
    sensitivity as never,
  );
  return { svc, prisma, usage, sensitivity };
}

// Convenience: baseline knowledge question row used by most grader tests.
const KNOWLEDGE_Q: FakeQuestion = {
  id: 'q1',
  kind: 'knowledge',
  skillIds: ['react'],
  difficulty: 'easy',
  prompt: 'What is a virtual DOM?',
  keyPoints: ['virtual DOM', 'reconciler', 'keys'],
  answerHint: null,
  flagged: false,
  sourceKind: null,
  sourceUrl: null,
  sourceAttribution: null,
};

beforeEach(() => {
  chatStructuredMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// runLlmGraderOrFallback: the private helper is exercised through the public
// grade*Attempt methods since every grader wraps it. Assert which grader tag
// landed on gradingJson to prove which branch won.
// -----------------------------------------------------------------------------

describe('runLlmGraderOrFallback (via gradeKnowledgeAttempt)', () => {
  it('LLM happy path: structured verdict lands on the attempt, grader=llm', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.9,
      hits: ['virtual DOM', 'reconciler'],
      misses: ['keys'],
      reasoning: 'Good coverage.',
    });
    const { svc, prisma } = build({ hasProvider: true, question: KNOWLEDGE_Q });
    const result = await svc.gradeKnowledgeAttempt('user-1', {
      questionId: 'q1',
      answer: 'The virtual DOM lets the reconciler diff trees.',
    });
    expect(result.score).toBe(0.9);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'llm' });
    expect(chatStructuredMock).toHaveBeenCalledTimes(1);
    // MUTATION-SMOKE: swap `grader: 'llm' as const` in runLlmGraderOrFallback
    // for `grader: 'rule' as const` → this test fails on the gradingJson tag.
  });

  it('provider throw falls back to deterministic rubric grader, grader=rule', async () => {
    chatStructuredMock.mockRejectedValueOnce(new Error('deepseek 500'));
    const { svc, prisma } = build({ hasProvider: true, question: KNOWLEDGE_Q });
    const result = await svc.gradeKnowledgeAttempt('user-1', {
      questionId: 'q1',
      answer: 'virtual DOM and reconciler power reconciliation with keys.',
    });
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
    // Rule grader = keyPoint overlap; all 3 keyPoints appear → score 1.
    expect(result.score).toBe(1);
    // MUTATION-SMOKE: delete the `try / catch → withFallback()` wrap so a
    // provider throw propagates → this test throws instead of returning.
  });

  it('Zod parse failure inside chatStructured falls back to rule grader', async () => {
    // The stub schema accepts anything, so simulate the "provider returned junk
    // that fails validation" path by throwing a ZodError-shaped error — the
    // service treats any thrown error from chatStructured as a fallback signal.
    const { ZodError } = await import('zod');
    chatStructuredMock.mockRejectedValueOnce(
      new ZodError([
        { code: 'custom', path: ['score'], message: 'invalid' },
      ]),
    );
    const { svc, prisma } = build({ hasProvider: true, question: KNOWLEDGE_Q });
    await svc.gradeKnowledgeAttempt('user-1', { questionId: 'q1', answer: 'virtual DOM.' });
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
    // MUTATION-SMOKE: narrow the catch to `catch (err) { if (!(err instanceof
    // LLMProviderError)) throw err; ... }` → ZodError re-throws, test fails.
  });

  it('timeout / long-running provider call bailing out via reject also lands on rule', async () => {
    chatStructuredMock.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { name: 'AbortError' }),
    );
    const { svc, prisma } = build({ hasProvider: true, question: KNOWLEDGE_Q });
    await svc.gradeKnowledgeAttempt('user-1', { questionId: 'q1', answer: 'reconciler and keys.' });
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
  });

  it('no provider configured → skip LLM entirely, grader=rule', async () => {
    const { svc, prisma } = build({ hasProvider: false, question: KNOWLEDGE_Q });
    await svc.gradeKnowledgeAttempt('user-1', { questionId: 'q1', answer: 'virtual DOM.' });
    expect(chatStructuredMock).not.toHaveBeenCalled();
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
    // MUTATION-SMOKE: change `if (!providerCfg) return withFallback();` to
    // `if (providerCfg) return withFallback();` → chatStructured is called,
    // assertion fails.
  });

  it('non-deepseek provider skipped, grader=rule', async () => {
    const { svc, prisma } = build({
      hasProvider: true,
      providerName: 'openai',
      question: KNOWLEDGE_Q,
    });
    await svc.gradeKnowledgeAttempt('user-1', { questionId: 'q1', answer: 'virtual DOM.' });
    expect(chatStructuredMock).not.toHaveBeenCalled();
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
  });
});

// -----------------------------------------------------------------------------
// Per-assessment-type grading: assert the returned score is in [0,1] and the
// grading payload shape matches what the runner UI reads. LLM branch is used
// so we can inject a known score and verify normalization.
// -----------------------------------------------------------------------------

describe('grade shape + normalization per assessment type', () => {
  it('knowledge: score in [0,1], hits/misses arrays', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.5,
      hits: ['virtual DOM'],
      misses: ['reconciler', 'keys'],
      reasoning: 'partial',
    });
    const { svc } = build({ hasProvider: true, question: KNOWLEDGE_Q });
    const r = await svc.gradeKnowledgeAttempt('user-1', { questionId: 'q1', answer: 'v-dom' });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.hits)).toBe(true);
    expect(Array.isArray(r.misses)).toBe(true);
    expect(r.xpAwarded).toBeGreaterThan(0);
  });

  it('code-review: precision/recall land on gradingJson, F1 in [0,1]', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.75,
      precision: 0.75,
      recall: 0.75,
      hits: ['off-by-one'],
      misses: ['null-deref'],
      falsePositives: [],
      reasoning: 'ok',
    });
    const q: FakeQuestion = { ...KNOWLEDGE_Q, id: 'cr1', kind: 'code-review', keyPoints: ['off-by-one', 'null-deref'] };
    const { svc, prisma } = build({ hasProvider: true, question: q });
    const r = await svc.gradeCodeReviewAttempt('user-1', {
      questionId: 'cr1',
      findings: ['loop bounds are off'],
    });
    expect(r.score).toBeCloseTo(0.75, 3);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({
      precision: 0.75,
      recall: 0.75,
      grader: 'llm',
    });
  });

  it('system-design: dimension scores clamp to 1..5, overall score in [0,1]', async () => {
    // Return one out-of-range score to prove clamping. Levels 0 and 9 must
    // land as 1 and 5 respectively on the persisted attempt.
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.8,
      dimensions: [
        { dimensionId: 'requirements', score: 9, notes: 'over-cap' },
        { dimensionId: 'data-model', score: 0, notes: 'under-cap' },
      ],
      reasoning: 'mixed',
    });
    const q: FakeQuestion = {
      ...KNOWLEDGE_Q,
      id: 'sd1',
      kind: 'system-design',
      keyPoints: ['requirements', 'data-model'],
      answerHint: JSON.stringify({ constraints: ['low latency'] }),
    };
    const { svc, prisma } = build({ hasProvider: true, question: q });
    const r = await svc.gradeSystemDesignAttempt('user-1', {
      questionId: 'sd1',
      design: 'API + DB + cache.',
    });
    expect(r.score).toBe(0.8);
    const gj = prisma.calls.attempts[0]!.gradingJson as {
      dimensions: Array<{ dimensionId: string; score: number }>;
    };
    // 9 → 5 (upper clamp), 0 → 1 (lower clamp)
    expect(gj.dimensions.find((d) => d.dimensionId === 'requirements')!.score).toBe(5);
    expect(gj.dimensions.find((d) => d.dimensionId === 'data-model')!.score).toBe(1);
    // MUTATION-SMOKE: change `Math.max(1, Math.min(5, d.score))` to plain
    // `d.score` in gradeSystemDesignWithLlmOrFallback → 9 and 0 leak through,
    // both assertions fail.
  });

  it('debugging: correctness + minimality land on gradingJson', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.85,
      correctness: 0.9,
      minimality: 0.8,
      reasoning: 'tight fix',
    });
    const q: FakeQuestion = {
      ...KNOWLEDGE_Q,
      id: 'db1',
      kind: 'debugging',
      keyPoints: ['off by one'],
      answerHint: JSON.stringify({ language: 'js', description: 'add loop', hint: 'compare bounds' }),
    };
    const { svc, prisma } = build({ hasProvider: true, question: q });
    const r = await svc.gradeDebuggingAttempt('user-1', { questionId: 'db1', fix: 'i < arr.length' });
    expect(r.score).toBe(0.85);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({
      correctness: 0.9,
      minimality: 0.8,
      grader: 'llm',
    });
  });

  it('mock-interview: per-question scores land on gradingJson, hits/misses summarise Q pass/fail', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.6,
      questions: [
        { index: 0, score: 0.9, hits: ['a'], misses: [], notes: '' },
        { index: 1, score: 0.5, hits: [], misses: ['b'], notes: '' },
        { index: 2, score: 0.4, hits: [], misses: ['c'], notes: '' },
      ],
      reasoning: 'mid',
    });
    const q: FakeQuestion = {
      ...KNOWLEDGE_Q,
      id: 'mi1',
      kind: 'mock-interview',
      keyPoints: [],
      answerHint: JSON.stringify({
        scenario: 'sr platform eng',
        questions: [
          { kind: 'technical', prompt: 'q1', keyPoints: ['a'] },
          { kind: 'technical', prompt: 'q2', keyPoints: ['b'] },
          { kind: 'behavioral', prompt: 'q3', keyPoints: ['c'] },
        ],
      }),
    };
    const { svc, prisma } = build({ hasProvider: true, question: q });
    const r = await svc.gradeMockInterviewAttempt('user-1', {
      questionId: 'mi1',
      answers: ['ans1', 'ans2', 'ans3'],
    });
    expect(r.score).toBe(0.6);
    // Only Q1 passes >= 0.7 → hits has one entry, misses has two.
    expect(r.hits).toHaveLength(1);
    expect(r.misses).toHaveLength(2);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'llm' });
    // MUTATION-SMOKE: change the `qg.score >= 0.7` threshold to `> 0.5` in the
    // hits/misses summariser → this assertion (1/2 split) breaks.
  });
});

// Rule-fallback shape smoke-test: rule grader must also produce a valid score
// per type so the attempt.create write does not blow up on toFixed(3).
describe('rule fallback produces valid scores for every type', () => {
  beforeEach(() => {
    // Force every fallback path — no provider configured.
  });

  it('rule knowledge grade is in [0,1]', async () => {
    const { svc, prisma } = build({ hasProvider: false, question: KNOWLEDGE_Q });
    const r = await svc.gradeKnowledgeAttempt('user-1', {
      questionId: 'q1',
      answer: 'virtual DOM',
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
  });

  it('rule code-review F1 score is in [0,1]', async () => {
    const q: FakeQuestion = { ...KNOWLEDGE_Q, id: 'cr2', kind: 'code-review', keyPoints: ['unhandled null'] };
    const { svc } = build({ hasProvider: false, question: q });
    const r = await svc.gradeCodeReviewAttempt('user-1', {
      questionId: 'cr2',
      findings: ['unhandled null pointer'],
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('rule debugging grade is in [0,1]', async () => {
    const q: FakeQuestion = {
      ...KNOWLEDGE_Q,
      id: 'db2',
      kind: 'debugging',
      prompt: 'for (i=0; i<=n; i++) sum+=arr[i]',
      keyPoints: ['off by one bound'],
      answerHint: JSON.stringify({ language: 'js', description: '', hint: '' }),
    };
    const { svc } = build({ hasProvider: false, question: q });
    const r = await svc.gradeDebuggingAttempt('user-1', {
      questionId: 'db2',
      fix: 'for (i=0; i<n; i++) sum+=arr[i]',
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('rule mock-interview grade is in [0,1]', async () => {
    const q: FakeQuestion = {
      ...KNOWLEDGE_Q,
      id: 'mi2',
      kind: 'mock-interview',
      keyPoints: [],
      answerHint: JSON.stringify({
        scenario: '',
        questions: [
          { kind: 'technical', prompt: 'q1', keyPoints: ['a'] },
          { kind: 'technical', prompt: 'q2', keyPoints: ['b'] },
          { kind: 'behavioral', prompt: 'q3', keyPoints: ['c'] },
        ],
      }),
    };
    const { svc } = build({ hasProvider: false, question: q });
    const r = await svc.gradeMockInterviewAttempt('user-1', {
      questionId: 'mi2',
      answers: ['a', 'b', 'c'],
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
