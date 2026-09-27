import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRegistry } from './registry';
import { runAgentEvals, type AgentEval } from './eval-set';
import type { AgentDef } from './types';
import type { AIProvider } from '../provider';

const InputSchema = z.object({ diff: z.string(), defects: z.array(z.string()) });
const OutputSchema = z.object({
  precision: z.number(),
  recall: z.number(),
  score: z.number(),
});

type Out = z.infer<typeof OutputSchema>;

function stubProvider(chatStructured: AIProvider['chatStructured']): AIProvider {
  return {
    name: 'stub',
    capabilities: {
      structuredOutput: true,
      streaming: false,
      toolUse: false,
      contextWindow: 8192,
      embeddings: false,
    },
    chat: async () => '',
    chatStructured,
    probe: async () => ({ reachable: true, latencyMs: 0 }),
  };
}

function makeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'grader',
    version: '1.0.0',
    description: 'grader',
    systemPrompt: 'grade',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    ...over,
  };
}

// F1 judge: pass when actual.score >= expected.minF1.
function f1Judge(actual: Out, expected: { minF1: number }) {
  const pass = actual.score >= expected.minF1;
  return {
    pass,
    score: Math.min(1, Math.max(0, actual.score)),
    detail: pass ? `F1 ${actual.score.toFixed(2)} >= ${expected.minF1}` : `F1 ${actual.score.toFixed(2)} < ${expected.minF1}`,
  };
}

describe('runAgentEvals (C-P2.8c)', () => {
  it('runs 2 fixtures against a mocked agent, both pass F1 gate', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    // Provider echoes score = 0.9 regardless of input — both fixtures pass.
    const provider = stubProvider((async () => ({
      precision: 0.9,
      recall: 0.9,
      score: 0.9,
    })) as AIProvider['chatStructured']);

    const evals: AgentEval<z.infer<typeof InputSchema>, Out, { minF1: number }>[] = [
      {
        id: 'obvious-null-deref',
        input: { diff: 'x.foo()', defects: ['null deref on x'] },
        expected: { minF1: 0.8 },
        judge: f1Judge,
      },
      {
        id: 'off-by-one',
        input: { diff: 'for (let i=0; i<=n; i++)', defects: ['off-by-one'] },
        expected: { minF1: 0.7 },
        judge: f1Judge,
      },
    ];

    const artifacts = await runAgentEvals('grader', evals, { agents, provider });
    expect(artifacts.report.total).toBe(2);
    expect(artifacts.report.passed).toBe(2);
    expect(artifacts.report.meanScore).toBeCloseTo(0.9);
    // JUnit + JSON emitters produce non-empty output.
    expect(artifacts.junitXml).toContain('<testsuites');
    expect(artifacts.jsonSummary.overall.passed).toBe(2);
    // Audit captured one event per fixture.
    expect(artifacts.audit).toHaveLength(2);
    for (const evt of artifacts.audit) {
      expect(evt.ok).toBe(true);
      expect(evt.agentId).toBe('grader');
    }
  });

  it('marks a fixture as fail when it misses the F1 gate', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    // Provider echoes score = 0.3; second fixture (expected 0.7) fails.
    const provider = stubProvider((async () => ({
      precision: 0.4,
      recall: 0.3,
      score: 0.3,
    })) as AIProvider['chatStructured']);

    const evals: AgentEval<z.infer<typeof InputSchema>, Out, { minF1: number }>[] = [
      {
        id: 'lenient-gate',
        input: { diff: 'a', defects: ['d1'] },
        expected: { minF1: 0.2 },
        judge: f1Judge,
      },
      {
        id: 'strict-gate',
        input: { diff: 'b', defects: ['d2'] },
        expected: { minF1: 0.7 },
        judge: f1Judge,
      },
    ];

    const artifacts = await runAgentEvals('grader', evals, { agents, provider });
    expect(artifacts.report.total).toBe(2);
    expect(artifacts.report.passed).toBe(1);
    // JUnit failure element present exactly once.
    const failureCount = (artifacts.junitXml.match(/<failure /g) ?? []).length;
    expect(failureCount).toBe(1);
  });
});
