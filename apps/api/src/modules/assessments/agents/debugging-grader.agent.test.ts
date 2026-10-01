import { describe, expect, it, vi } from 'vitest';
import { DebuggingGradeSchema } from '@careeros/shared';
import type { AIProvider } from '@careeros/ai';
import { DebuggingGraderAgent } from './debugging-grader.agent';

// Fake AIProvider that returns a canned Zod-valid grade and records the
// messages it saw. Covers the one thing the grader is supposed to do:
// take question text + candidate attempt, render a prompt, call the
// provider, parse the structured response, return the typed Grade shape.
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
    chatStructured: (async ({ messages, schema }: { messages: Array<{ role: string; content: string }>; schema: typeof DebuggingGradeSchema }) => {
      seen.system = messages.find((m) => m.role === 'system')?.content;
      seen.user = messages.find((m) => m.role === 'user')?.content;
      // Round-trip through the schema so the fake cannot drift from the real
      // contract (adding a required field to DebuggingGradeSchema would fail
      // this test, not production).
      return schema.parse(response);
    }) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
  };
}

describe('DebuggingGraderAgent.grade', () => {
  it('renders prompt from inputs, calls provider.chatStructured, returns Zod-valid DebuggingGrade', async () => {
    const seen: { system: string | undefined; user: string | undefined } = { system: undefined, user: undefined };
    const provider = fakeProvider(
      { score: 0.82, correctness: 0.9, minimality: 0.7, reasoning: 'Fix narrows the off-by-one.' },
      seen,
    );
    const grader = new DebuggingGraderAgent();

    const out = await grader.grade(provider, {
      description: 'Return the max of two numbers.',
      brokenCode: 'function max(a,b){ return a>b ? a : a; }',
      rootCause: 'returns a in both branches',
      fix: 'function max(a,b){ return a>b ? a : b; }',
    });

    // Shape asserted explicitly, not inferred — this is the contract the
    // service persists onto gradingJson.
    expect(DebuggingGradeSchema.safeParse(out).success).toBe(true);
    expect(out.score).toBe(0.82);
    expect(out.correctness).toBe(0.9);
    expect(out.minimality).toBe(0.7);
    expect(out.reasoning).toContain('off-by-one');

    // Prompt actually carried the question text + candidate fix (otherwise
    // the grader isn't grading anything).
    expect(seen.user).toContain('Return the max of two numbers.');
    expect(seen.user).toContain('function max(a,b){ return a>b ? a : a; }');
    expect(seen.user).toContain('function max(a,b){ return a>b ? a : b; }');
    expect(seen.user).toContain('returns a in both branches');
    expect(seen.system).toContain('debugging attempt');
  });

  it('rejects invalid grader input (empty fix) BEFORE touching the provider', async () => {
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
    const grader = new DebuggingGraderAgent();

    await expect(
      grader.grade(provider, {
        description: 'x',
        brokenCode: 'code',
        rootCause: 'r',
        fix: '', // InputSchema requires .min(1) — must throw before the LLM call
      }),
    ).rejects.toThrow();
    expect(chatStructured).not.toHaveBeenCalled();
  });
});

// Keep vi happy with unused import tree-shake in strict configs.
void vi;
