import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { AgentRegistry } from './registry';
import { runAgent, setAgentAuditHook, type AgentAuditEvent } from './orchestrator';
import type { AgentDef } from './types';
import type { AIProvider } from '../provider';
import { StructuredOutputError } from '../errors';

const InputSchema = z.object({ question: z.string(), answer: z.string() });
const OutputSchema = z.object({ score: z.number().min(0).max(1), reasoning: z.string() });

function stubProvider(overrides: Partial<AIProvider> = {}): AIProvider {
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
    chatStructured: (async () => ({ score: 1, reasoning: 'ok' })) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
    ...overrides,
  };
}

function makeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'test-grader',
    version: '1.0.0',
    description: 'test grader',
    systemPrompt: 'grade the answer',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    ...over,
  };
}

const audit: AgentAuditEvent[] = [];

beforeEach(() => {
  audit.length = 0;
  setAgentAuditHook((e) => audit.push(e));
});

afterEach(() => {
  setAgentAuditHook(null);
});

describe('runAgent happy path (C-P2.8b)', () => {
  it('validates input, calls provider.chatStructured, returns typed output + audit', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    const provider = stubProvider({
      chatStructured: (async () => ({ score: 0.8, reasoning: 'good' })) as AIProvider['chatStructured'],
    });
    const run = await runAgent(
      'test-grader',
      { question: 'What is 2+2?', answer: '4' },
      { agents, provider },
    );
    expect(run.output.score).toBe(0.8);
    expect(run.provider).toBe('stub');
    expect(run.promptVersion).toBe('test-grader@1.0.0');
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.code).toBe('security.audit.agent_run');
    expect(audit[0]?.ok).toBe(true);
    expect(audit[0]?.agentId).toBe('test-grader');
    expect(audit[0]?.version).toBe('1.0.0');
  });

  it('wraps input strings through wrapUntrusted before schema-validating', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    let seenUserMessage = '';
    const provider = stubProvider({
      chatStructured: (async ({ messages }) => {
        seenUserMessage = messages[messages.length - 1]?.content ?? '';
        return { score: 1, reasoning: 'ok' };
      }) as AIProvider['chatStructured'],
    });
    await runAgent(
      'test-grader',
      { question: 'q', answer: 'a' },
      { agents, provider, untrustedSource: 'resume' },
    );
    // JSON.stringify escapes the quotes, but the untrusted wrapper still
    // shows up verbatim (source tag + closing delimiter both survive).
    expect(seenUserMessage).toContain('<untrusted source=\\"resume\\"');
    expect(seenUserMessage).toContain('</untrusted>');
  });
});

describe('runAgent input invalidation (C-P2.8b)', () => {
  it('throws BEFORE the LLM call when input fails the schema', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    const chatStructured = vi.fn(async () => ({ score: 1, reasoning: 'ok' }));
    const provider = stubProvider({
      chatStructured: chatStructured as unknown as AIProvider['chatStructured'],
    });
    await expect(
      // missing answer field
      runAgent('test-grader', { question: 'q' } as unknown, { agents, provider }),
    ).rejects.toThrow(/input schema failed/);
    expect(chatStructured).not.toHaveBeenCalled();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.ok).toBe(false);
    expect(audit[0]?.error).toMatch(/input schema failed/);
  });
});

describe('runAgent output invalidation retry (C-P2.8b)', () => {
  it('propagates StructuredOutputError when provider retry also fails', async () => {
    // A-H5 retry is inside DeepSeekProvider.chatStructured; the orchestrator
    // does not re-implement it. A provider that emits StructuredOutputError
    // bubbles out and lands in a failed audit event.
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    const provider = stubProvider({
      chatStructured: (async () => {
        throw new StructuredOutputError('bad json');
      }) as AIProvider['chatStructured'],
    });
    await expect(
      runAgent('test-grader', { question: 'q', answer: 'a' }, { agents, provider }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.ok).toBe(false);
    expect(audit[0]?.error).toMatch(/schema validation/);
  });

  it('happy-path retry: provider returns a valid object on second attempt (A-H5 reuse)', async () => {
    // Simulate the A-H5 pattern locally: a provider that fails once then
    // succeeds. Any orchestrator that re-invokes wrapping across a retry
    // should still yield a single audit event (retry lives inside the
    // provider surface, not this layer).
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    let attempts = 0;
    const provider = stubProvider({
      chatStructured: (async () => {
        attempts += 1;
        if (attempts === 1) throw new ZodError([]);
        return { score: 0.5, reasoning: 'second try' };
      }) as AIProvider['chatStructured'],
    });
    // First runAgent call bubbles the ZodError (no orchestrator-level retry
    // by design). Ponytail: provider owns retry so callers see one policy.
    await expect(
      runAgent('test-grader', { question: 'q', answer: 'a' }, { agents, provider }),
    ).rejects.toBeInstanceOf(ZodError);
    const second = await runAgent(
      'test-grader',
      { question: 'q', answer: 'a' },
      { agents, provider },
    );
    expect(second.output.score).toBe(0.5);
    expect(audit).toHaveLength(2);
    expect(audit[0]?.ok).toBe(false);
    expect(audit[1]?.ok).toBe(true);
  });
});

describe('runAgent provider resolution (C-P2.8b)', () => {
  it('throws when no provider + no registry supplied', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent());
    await expect(
      runAgent('test-grader', { question: 'q', answer: 'a' }, { agents }),
    ).rejects.toThrow(/no provider/);
  });

  it('resolves provider from ctx.providers by agent.provider name', async () => {
    const agents = new AgentRegistry();
    agents.register(makeAgent({ provider: 'stub' }));
    const { ProviderRegistry } = await import('../registry');
    const providers = new ProviderRegistry();
    const provider = stubProvider();
    providers.register('stub', () => provider);
    const run = await runAgent(
      'test-grader',
      { question: 'q', answer: 'a' },
      { agents, providers },
    );
    expect(run.provider).toBe('stub');
  });
});
