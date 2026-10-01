import { describe, expect, it, vi } from 'vitest';
import { RubricGradeSchema } from '@careeros/shared';
import type { AIProvider } from '@careeros/ai';
import { SystemDesignGraderAgent } from './system-design-grader.agent';

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
    chatStructured: (async ({ messages, schema }: { messages: Array<{ role: string; content: string }>; schema: typeof RubricGradeSchema }) => {
      seen.system = messages.find((m) => m.role === 'system')?.content;
      seen.user = messages.find((m) => m.role === 'user')?.content;
      return schema.parse(response);
    }) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
  };
}

describe('SystemDesignGraderAgent.grade', () => {
  it('renders prompt, calls chatStructured, returns Zod-valid RubricGrade with per-dimension scores', async () => {
    const seen: { system: string | undefined; user: string | undefined } = { system: undefined, user: undefined };
    const provider = fakeProvider(
      {
        score: 0.72,
        dimensions: [
          { dimensionId: 'requirements', score: 4, notes: 'Lists FR + NFR clearly.' },
          { dimensionId: 'tradeoffs', score: 3, notes: 'Some tradeoffs discussed.' },
          { dimensionId: 'scalability', score: 4, notes: 'Sharding plan is explicit.' },
        ],
        reasoning: 'Solid overall with light tradeoff analysis.',
      },
      seen,
    );
    const grader = new SystemDesignGraderAgent();

    const out = await grader.grade(provider, {
      scenario: 'Design a URL shortener that handles 10k rps.',
      constraints: '- 99.9% availability\n- p99 < 100ms',
      rubric:
        '- requirements (Requirements):\n    1. missing\n    5. fully listed\n' +
        '- tradeoffs (Tradeoffs):\n    1. none\n    5. explicit\n' +
        '- scalability (Scalability):\n    1. ignored\n    5. sharding + capacity numbers',
      design: 'FR: shorten+redirect. NFR: 10k rps. Sharded by hash.',
    });

    expect(RubricGradeSchema.safeParse(out).success).toBe(true);
    expect(out.score).toBe(0.72);
    expect(out.dimensions).toHaveLength(3);
    expect(out.dimensions[0]!.dimensionId).toBe('requirements');
    expect(out.dimensions[0]!.score).toBe(4);
    expect(out.dimensions.map((d) => d.score)).toEqual([4, 3, 4]);

    // Prompt carried the scenario + constraints + rubric + candidate design.
    expect(seen.user).toContain('URL shortener');
    expect(seen.user).toContain('99.9% availability');
    expect(seen.user).toContain('sharding + capacity numbers');
    expect(seen.user).toContain('Sharded by hash');
    expect(seen.system).toContain('system-design');
  });

  it('rejects empty scenario/design input BEFORE touching the provider', async () => {
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
    const grader = new SystemDesignGraderAgent();

    await expect(
      grader.grade(provider, {
        scenario: '', // InputSchema requires .min(1)
        constraints: '',
        rubric: 'r',
        design: 'd',
      }),
    ).rejects.toThrow();
    expect(chatStructured).not.toHaveBeenCalled();
  });
});

void vi;
