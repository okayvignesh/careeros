import { describe, expect, it } from 'vitest';
import type { AIProvider } from '@careeros/ai';
import { VerbalDefenseGradeSchema } from '../prompts/verbal-defense-grader';
import { VerbalDefenseGraderAgent, gradeVerbalDefense } from './verbal-defense-grader.agent';

function fakeProvider(
  response: unknown,
  seen: { system: string | undefined; user: string | undefined } = {
    system: undefined,
    user: undefined,
  },
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
    chatStructured: (async ({
      messages,
      schema,
    }: {
      messages: Array<{ role: string; content: string }>;
      schema: typeof VerbalDefenseGradeSchema;
    }) => {
      seen.system = messages.find((m) => m.role === 'system')?.content;
      seen.user = messages.find((m) => m.role === 'user')?.content;
      return schema.parse(response);
    }) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
  };
}

describe('VerbalDefenseGraderAgent', () => {
  it('renders the prompt and returns a Zod-valid grade', async () => {
    const seen: { system: string | undefined; user: string | undefined } = {
      system: undefined,
      user: undefined,
    };
    const provider = fakeProvider(
      {
        score: 0.75,
        technicalAccuracy: 0.8,
        communication: 0.7,
        hits: ['virtual DOM'],
        misses: ['keys'],
        reasoning: 'Good but missed keys.',
      },
      seen,
    );
    const out = await new VerbalDefenseGraderAgent().grade(provider, {
      prompt: 'Explain React reconciliation.',
      keyPoints: '- virtual DOM\n- keys',
      transcript: 'React builds a virtual DOM and diffs it.',
    });
    expect(VerbalDefenseGradeSchema.safeParse(out).success).toBe(true);
    expect(out.technicalAccuracy).toBe(0.8);
    expect(seen.user).toContain('React reconciliation');
    expect(seen.user).toContain('virtual DOM');
    expect(seen.system).toContain('transcript');
  });

  it('rejects an empty transcript before calling the provider', async () => {
    const provider = fakeProvider({});
    await expect(
      new VerbalDefenseGraderAgent().grade(provider, {
        prompt: 'q',
        keyPoints: '- a',
        transcript: '',
      }),
    ).rejects.toThrow();
  });
});

describe('gradeVerbalDefense (rule fallback)', () => {
  it('scores key-point coverage and normalizes to [0,1]', () => {
    const g = gradeVerbalDefense(
      'The virtual DOM lets the reconciler diff trees, and keys keep item identity stable.',
      ['virtual DOM', 'reconciler', 'keys'],
    );
    expect(g.hits.sort()).toEqual(['keys', 'reconciler', 'virtual DOM'].sort());
    expect(g.technicalAccuracy).toBe(1);
    expect(g.score).toBeGreaterThan(0);
    expect(g.score).toBeLessThanOrEqual(1);
  });

  it('is deterministic for the same input', () => {
    const a = gradeVerbalDefense('nothing relevant here at all', ['quantum', 'rust']);
    const b = gradeVerbalDefense('nothing relevant here at all', ['quantum', 'rust']);
    expect(a).toEqual(b);
    expect(a.technicalAccuracy).toBe(0);
  });
});
