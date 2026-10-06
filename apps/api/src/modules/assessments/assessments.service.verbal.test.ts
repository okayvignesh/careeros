// Verbal-defense grading path: start session -> store audio + transcribe
// (stubbed STT client) -> grade transcript (LLM or rule fallback) -> attempt +
// evidence + XP. No MinIO and no live whisper.cpp: the `audioStore` and
// `whisper` seams are overwritten with stubs before the call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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

vi.mock('@careeros/aggregator', () => ({
  syncSkillState: vi.fn(async () => ({
    state: {
      proficiency: 0.5,
      confidence: 0.5,
      recencyDays: 0,
      historicalDemonstrated: 1,
      evidenceCount: 1,
    },
    level: 2,
    before: null,
  })),
}));

vi.mock('../../common/llm-audit', () => ({ makeLlmAuditor: () => async () => {} }));

// eslint-disable-next-line import/first
import { AssessmentsService } from './assessments.service';

interface SessionRow {
  id: string;
  userId: string;
  questionId: string | null;
  prompt: string;
  skillIds: string[];
  difficulty: string;
  status: string;
  audioKey: string | null;
  audioMime: string | null;
  language: string | null;
  transcript: string | null;
  transcriptJson: unknown;
  score: string | number | null;
  reasoning: string | null;
  gradingJson: unknown;
  attemptId: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
  transcribedAt: Date | null;
  gradedAt: Date | null;
}

function fakePrisma(opts: { hasProvider?: boolean; keyPoints?: string[] } = {}) {
  const sessions: SessionRow[] = [];
  const questions = new Map<
    string,
    {
      id: string;
      kind: string;
      keyPoints: string[];
      skillIds: string[];
      difficulty: string;
      prompt: string;
    }
  >();
  const attempts: Array<{ id: string; kind: string; score: string; gradingJson: unknown }> = [];
  const evidence: unknown[] = [];
  const xpEvents: Array<{ reason: string; xp: number }> = [];
  let seq = 1;

  const q = {
    id: 'q-verbal',
    kind: 'verbal-defense',
    keyPoints: opts.keyPoints ?? ['virtual DOM', 'keys'],
    skillIds: ['react'],
    difficulty: 'medium',
    prompt: 'Explain React reconciliation.',
  };
  questions.set(q.id, q);

  return {
    calls: { sessions, attempts, evidence, xpEvents, questions },
    question: {
      findUnique: async ({ where }: { where: { id: string } }) => questions.get(where.id) ?? null,
      findMany: async () => [...questions.values()].filter((x) => x.kind === 'verbal-defense'),
      upsert: async ({
        where,
        create,
      }: {
        where: { promptHash: string };
        create: Record<string, unknown>;
      }) => {
        const row = {
          id: `q-${seq++}`,
          kind: String(create.kind),
          keyPoints: (create.keyPoints as string[]) ?? [],
          skillIds: (create.skillIds as string[]) ?? [],
          difficulty: String(create.difficulty),
          prompt: String(create.prompt),
        };
        questions.set(row.id, row);
        void where;
        return row;
      },
    },
    providerConfig: {
      findFirst: async () =>
        opts.hasProvider
          ? {
              id: 'cfg',
              provider: 'deepseek',
              isDefault: true,
              apiKeySecretId: 'sec',
              baseUrl: null,
              chatModel: 'deepseek-chat',
            }
          : null,
    },
    encryptedSecret: { findUnique: async () => ({ id: 'sec', ciphertext: Buffer.from('x') }) },
    attempt: {
      create: async ({
        data,
      }: {
        data: { kind: string; score: string; gradingJson: unknown; questionId: string };
      }) => {
        const id = `att-${seq++}`;
        attempts.push({ id, kind: data.kind, score: data.score, gradingJson: data.gradingJson });
        return { id };
      },
      findMany: async () => [],
      count: async () => attempts.length,
    },
    skill: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id,
      }),
    },
    candidateSkillState: { findUnique: async () => null },
    evidence: { create: async ({ data }: { data: unknown }) => (evidence.push(data), {}) },
    xpEvent: {
      create: async ({ data }: { data: { reason: string; xp: number } }) => (
        xpEvents.push(data),
        {}
      ),
      aggregate: async () => ({ _sum: { xp: xpEvents.reduce((a, e) => a + e.xp, 0) } }),
    },
    streak: { findUnique: async () => null, upsert: async () => ({}) },
    remediationTask: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
    verbalSession: {
      create: async ({ data }: { data: Partial<SessionRow> }) => {
        const row: SessionRow = {
          id: `vs-${seq++}`,
          userId: data.userId!,
          questionId: data.questionId ?? null,
          prompt: data.prompt!,
          skillIds: data.skillIds ?? [],
          difficulty: data.difficulty ?? 'medium',
          status: data.status ?? 'created',
          audioKey: null,
          audioMime: null,
          language: null,
          transcript: null,
          transcriptJson: null,
          score: null,
          reasoning: null,
          gradingJson: null,
          attemptId: null,
          durationMs: null,
          error: null,
          createdAt: new Date(),
          transcribedAt: null,
          gradedAt: null,
        };
        sessions.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        sessions.find((s) => s.id === where.id && s.userId === where.userId) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        sessions.filter((s) => s.userId === where.userId),
      update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
        const row = sessions.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
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

function build(opts?: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(opts);
  const svc = new AssessmentsService(
    prisma as never,
    fakeUsage() as never,
    { get: () => null, set: () => {} } as never,
    fakeSensitivity() as never,
  );
  const audioPut = vi.fn(
    async (userId: string, sessionId: string) => `verbal/${userId}/${sessionId}/x.webm`,
  );
  const audioPresign = vi.fn(async () => 'https://minio.local/presigned');
  const transcribe = vi.fn(async () => ({
    text: 'The virtual DOM and keys drive reconciliation.',
    language: 'en',
    segments: [{ id: 0, start: 0, end: 2, text: 'The virtual DOM and keys drive reconciliation.' }],
  }));
  // reach into the protected seams
  (svc as unknown as { audioStore: unknown }).audioStore = {
    put: audioPut,
    presign: audioPresign,
    remove: vi.fn(),
  };
  (svc as unknown as { whisper: unknown }).whisper = { transcribe };
  return { svc, prisma, audioPut, audioPresign, transcribe };
}

beforeEach(() => chatStructuredMock.mockReset());

describe('nextVerbalPrompt / startVerbalSession', () => {
  it('seeds a verbal prompt and returns bank-backed fields', async () => {
    const { svc, prisma } = build();
    const p = await svc.nextVerbalPrompt('user-1');
    expect(p.prompt.length).toBeGreaterThan(10);
    expect(p.skillIds.length).toBeGreaterThan(0);
    expect(prisma.calls.questions.size).toBeGreaterThan(0);
  });

  it('start with an ad-hoc prompt upserts a question row and creates a session', async () => {
    const { svc, prisma } = build();
    const view = await svc.startVerbalSession('user-1', {
      prompt: 'Describe a hard production incident you debugged.',
      keyPoints: ['symptom', 'root cause', 'fix'],
      skillIds: ['node-js'],
      difficulty: 'hard',
    });
    expect(view.status).toBe('created');
    expect(view.questionId).toBeTruthy();
    expect(view.prompt).toContain('production incident');
    expect(view.skillIds).toEqual(['node-js']);
    expect(prisma.calls.sessions).toHaveLength(1);
  });

  it('start with an unknown questionId throws NotFound', async () => {
    const { svc } = build();
    await expect(svc.startVerbalSession('user-1', { questionId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('attachVerbalAudio (stubbed STT)', () => {
  it('stores the audio, transcribes it, and persists the transcript', async () => {
    const { svc, audioPut, transcribe } = build();
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    const view = await svc.attachVerbalAudio('user-1', session.id, {
      buffer: Buffer.from('fake-webm-bytes'),
      mimetype: 'audio/webm',
      size: 15,
    });
    expect(audioPut).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('transcribed');
    expect(view.transcript).toContain('virtual DOM');
    expect(view.audioUrl).toBe('https://minio.local/presigned');
    expect(view.segments?.[0]?.text).toContain('virtual DOM');
  });

  it('reports unavailable (does not throw) when whisper is not configured', async () => {
    const { svc, transcribe } = build();
    const { SttUnavailableError } = await import('@careeros/stt');
    transcribe.mockRejectedValueOnce(new SttUnavailableError());
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    const view = await svc.attachVerbalAudio('user-1', session.id, {
      buffer: Buffer.from('x'),
      mimetype: 'audio/webm',
      size: 1,
    });
    expect(view.status).toBe('unavailable');
    expect(view.error).toMatch(/not configured/i);
  });

  it('rejects an unsupported audio mimetype before uploading', async () => {
    const { svc, audioPut } = build();
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    await expect(
      svc.attachVerbalAudio('user-1', session.id, {
        buffer: Buffer.from('x'),
        mimetype: 'application/pdf',
        size: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audioPut).not.toHaveBeenCalled();
  });
});

describe('gradeVerbalSession', () => {
  it('grades the stored transcript via the LLM grader and writes an attempt + XP', async () => {
    chatStructuredMock.mockResolvedValueOnce({
      score: 0.8,
      technicalAccuracy: 0.9,
      communication: 0.7,
      hits: ['virtual DOM', 'keys'],
      misses: [],
      reasoning: 'Strong answer.',
    });
    const { svc, prisma } = build({ hasProvider: true });
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    await svc.attachVerbalAudio('user-1', session.id, {
      buffer: Buffer.from('x'),
      mimetype: 'audio/webm',
      size: 1,
    });
    const result = await svc.gradeVerbalSession('user-1', session.id);
    expect(result.score).toBeCloseTo(0.8, 3);
    expect(result.xpAwarded).toBeGreaterThan(0);
    expect(prisma.calls.attempts[0]!.kind).toBe('verbal-defense');
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({
      technicalAccuracy: 0.9,
      communication: 0.7,
      grader: 'llm',
    });
    const row = prisma.calls.sessions[0]!;
    expect(row.status).toBe('graded');
    expect(row.attemptId).toBe(result.attemptId);
    expect(prisma.calls.evidence).toHaveLength(1);
  });

  it('falls back to the deterministic grader when no provider is configured', async () => {
    const { svc, prisma } = build({ hasProvider: false, keyPoints: ['virtual DOM', 'keys'] });
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    await svc.attachVerbalAudio('user-1', session.id, {
      buffer: Buffer.from('x'),
      mimetype: 'audio/webm',
      size: 1,
    });
    const result = await svc.gradeVerbalSession('user-1', session.id);
    expect(chatStructuredMock).not.toHaveBeenCalled();
    expect(prisma.calls.attempts[0]!.gradingJson).toMatchObject({ grader: 'rule' });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('throws when there is no transcript to grade', async () => {
    const { svc } = build();
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    await expect(svc.gradeVerbalSession('user-1', session.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('can grade an explicit transcript passed by the caller (no audio upload)', async () => {
    const { svc, prisma } = build({ hasProvider: false, keyPoints: ['keys'] });
    const session = await svc.startVerbalSession('user-1', { questionId: 'q-verbal' });
    const result = await svc.gradeVerbalSession('user-1', session.id, {
      transcript: 'I use keys to keep identity stable.',
    });
    expect(result.score).toBeGreaterThan(0);
    expect(prisma.calls.sessions[0]!.status).toBe('graded');
  });
});
