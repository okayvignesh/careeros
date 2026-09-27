import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRegistry } from './registry';
import type { AgentDef } from './types';

function makeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'sample',
    version: '1.0.0',
    description: 'sample agent',
    systemPrompt: 'you are a sample',
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ a: z.string() }),
    ...over,
  };
}

describe('AgentRegistry.register (C-P2.8)', () => {
  it('accepts a new agent', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent());
    expect(reg.list()).toHaveLength(1);
  });

  it('is idempotent on identical re-register', () => {
    const reg = new AgentRegistry();
    const a = makeAgent();
    reg.register(a);
    reg.register({ ...a });
    expect(reg.list()).toHaveLength(1);
  });

  it('throws when same id+version has different content', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent({ systemPrompt: 'v1' }));
    expect(() => reg.register(makeAgent({ systemPrompt: 'v2' }))).toThrow(
      /already registered with different content/,
    );
  });

  it('accepts multiple versions of the same id', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent({ version: '1.0.0' }));
    reg.register(makeAgent({ version: '1.1.0', systemPrompt: 'v2' }));
    expect(reg.list()).toHaveLength(2);
  });

  it('rejects missing id / version / schemas', () => {
    const reg = new AgentRegistry();
    expect(() => reg.register(makeAgent({ id: '' }))).toThrow(/id required/);
    expect(() => reg.register(makeAgent({ version: '' }))).toThrow(/missing version/);
    expect(() =>
      reg.register({ ...makeAgent(), inputSchema: undefined as unknown as z.ZodTypeAny }),
    ).toThrow(/missing inputSchema/);
    expect(() =>
      reg.register({ ...makeAgent(), outputSchema: undefined as unknown as z.ZodTypeAny }),
    ).toThrow(/missing outputSchema/);
  });
});

describe('AgentRegistry.resolve (C-P2.8)', () => {
  it('returns latest version when omitted', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent({ version: '1.0.0' }));
    reg.register(makeAgent({ version: '1.2.0', systemPrompt: 'v2' }));
    reg.register(makeAgent({ version: '1.10.0', systemPrompt: 'v3' }));
    expect(reg.resolve('sample').version).toBe('1.10.0');
  });

  it('returns specific version when requested', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent({ version: '1.0.0' }));
    reg.register(makeAgent({ version: '2.0.0', systemPrompt: 'v2' }));
    expect(reg.resolve('sample', '1.0.0').version).toBe('1.0.0');
    expect(reg.resolve('sample', '2.0.0').version).toBe('2.0.0');
  });

  it('throws on unknown id / version', () => {
    const reg = new AgentRegistry();
    expect(() => reg.resolve('missing')).toThrow(/'missing' not registered/);
    reg.register(makeAgent({ version: '1.0.0' }));
    expect(() => reg.resolve('sample', '9.9.9')).toThrow(/'sample@9.9.9' not registered/);
  });
});

describe('AgentRegistry.list (C-P2.8)', () => {
  it('lists id, version, description, tools per entry', () => {
    const reg = new AgentRegistry();
    reg.register(
      makeAgent({
        version: '1.0.0',
        provider: 'deepseek',
        tools: [
          { name: 't1', description: '', argsSchema: z.object({}), invoke: async () => null },
        ],
      }),
    );
    const info = reg.list();
    expect(info).toHaveLength(1);
    expect(info[0]?.id).toBe('sample');
    expect(info[0]?.provider).toBe('deepseek');
    expect(info[0]?.tools).toEqual(['t1']);
  });
});

describe('AgentRegistry.hashOf (C-P2.8)', () => {
  it('is deterministic', () => {
    expect(AgentRegistry.hashOf(makeAgent())).toBe(AgentRegistry.hashOf(makeAgent()));
  });

  it('changes when systemPrompt changes', () => {
    expect(AgentRegistry.hashOf(makeAgent({ systemPrompt: 'a' }))).not.toBe(
      AgentRegistry.hashOf(makeAgent({ systemPrompt: 'b' })),
    );
  });
});
