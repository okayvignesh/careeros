import { describe, expect, it, vi } from 'vitest';
import { MockInterviewGradeSchema } from '@careeros/shared';
import type { AIProvider } from '@careeros/ai';
import { MockInterviewGraderAgent } from './mock-interview-grader.agent';

function fakeProvider(
  response: unknown,
  seen: { system: string | undefined; user: string | undefined } = { system: undefined, user: undefined },
): AIProvider {
  return {
    name: 'fake',
    capabilities: {
      structuredOutput: true,
      streaming: false,
      toolUse: false,
      contextWindow: 8192,
      embeddings: false,
    },
    chat: async () => '',
    chatStructured: (async ({ messages, schema }: { messages: Array<{ role: string; content: string }>; schema: typeof MockInterviewGradeSchema }) => {
      seen.system = messages.find((m) => m.role === 'system')?.content;
      seen.user = messages.find((m) => m.role === 'user')?.content;
      return schema.parse(response);
    }) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
  };
}

describe('MockInterviewGraderAgent.grade', () => {
  it('renders prompt, calls chatStructured, returns Zod-valid MockInterviewGrade with 3 per-Q scores', async () => {
    const seen: { system: string | undefined; user: string | undefined } = { system: undefined, user: undefined };
    const provider = fakeProvider(
      {
        score: 0.6,
        questions: [
          { index: 0, score: 0.9, hits: ['cache'], misses: [], notes: 'solid technical' },
          { index: 1, score: 0.5, hits: [], misses: ['tradeoffs'], notes: 'thin on tradeoffs' },
          { index: 2, score: 0.4, hits: [], misses: ['own role'], notes: 'behavioral weak' },
        ],
        reasoning: 'Strong on Q1, weak on Q3.',
      },
      seen,
    );
    const grader = new MockInterviewGraderAgent();

    const out = await grader.grade(provider, {
      scenario: 'Design review for a URL shortener.',
      questions:
        '1. [technical] How would you cache?\n   Key points: hit ratio, TTL\n\n' +
        '2. [technical] Tradeoffs of consistent hashing?\n   Key points: rebalance, hot keys\n\n' +
        '3. [behavioral] Tell me about a tough bug.\n   Key points: concrete example, own role, outcome',
      answers: '1. I would use an LRU cache...\n\n2. Consistent hashing...\n\n3. We hit a memory leak...',
    });

    expect(MockInterviewGradeSchema.safeParse(out).success).toBe(true);
    expect(out.score).toBe(0.6);
    expect(out.questions).toHaveLength(3);
    expect(out.questions.map((q) => q.index)).toEqual([0, 1, 2]);
    expect(out.questions[0]!.score).toBe(0.9);
    expect(out.questions[2]!.notes).toContain('behavioral');

    // Prompt actually carried the scenario + questions block + candidate
    // answers block; this is the proof the grader is grading real inputs.
    expect(seen.user).toContain('URL shortener');
    expect(seen.user).toContain('How would you cache?');
    expect(seen.user).toContain('I would use an LRU cache');
    expect(seen.system).toContain('mock-interview');
  });

  it('rejects empty questions/answers input BEFORE touching the provider', async () => {
    const chatStructured = vi.fn();
    const provider: AIProvider = {
      name: 'fake',
      capabilities: {
        structuredOutput: true,
        streaming: false,
        toolUse: false,
        contextWindow: 8192,
        embeddings: false,
      },
      chat: async () => '',
      chatStructured: chatStructured as unknown as AIProvider['chatStructured'],
      probe: async () => ({ reachable: true, latencyMs: 0 }),
    };
    const grader = new MockInterviewGraderAgent();

    await expect(
      grader.grade(provider, {
        scenario: 's',
        questions: '', // InputSchema requires .min(1)
        answers: 'a',
      }),
    ).rejects.toThrow();
    expect(chatStructured).not.toHaveBeenCalled();
  });
});

void vi;
