import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from './registry';
import type { AIProvider } from './provider';

function stubProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: 'stub',
    capabilities: {
      structuredOutput: false,
      streaming: false,
      toolUse: false,
      contextWindow: 4096,
      embeddings: false,
    },
    chat: async () => '',
    chatStructured: (async () => ({})) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
    ...overrides,
  };
}

describe('ProviderRegistry (C-P0.1)', () => {
  it('register + resolve returns the same instance', () => {
    const reg = new ProviderRegistry();
    const p = stubProvider({ name: 'a' });
    reg.register('a', () => p);
    expect(reg.resolve('a')).toBe(p);
    // Mutation smoke: second resolve returns the *same* cached object.
    expect(reg.resolve('a')).toBe(p);
  });

  it('resolve throws on unknown name', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.resolve('missing')).toThrow(/not registered/);
  });

  it('register throws on duplicate name (prevents silent override)', () => {
    const reg = new ProviderRegistry();
    reg.register('a', () => stubProvider());
    expect(() => reg.register('a', () => stubProvider())).toThrow(/already registered/);
  });

  it('register rejects empty name', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.register('', () => stubProvider())).toThrow(/name required/);
  });

  it('list returns every registered provider with its capabilities', () => {
    const reg = new ProviderRegistry();
    reg.register('a', () =>
      stubProvider({ name: 'a', capabilities: { structuredOutput: true, streaming: false, toolUse: false, contextWindow: 8192, embeddings: false } }),
    );
    reg.register('b', () =>
      stubProvider({ name: 'b', capabilities: { structuredOutput: false, streaming: true, toolUse: true, contextWindow: 128_000, embeddings: true } }),
    );
    const list = reg.list();
    expect(list).toHaveLength(2);
    const byName = Object.fromEntries(list.map((i) => [i.name, i.capabilities]));
    expect(byName.a?.contextWindow).toBe(8192);
    expect(byName.b?.contextWindow).toBe(128_000);
    expect(byName.b?.streaming).toBe(true);
  });

  it('factory is invoked lazily (once per name)', () => {
    const reg = new ProviderRegistry();
    const factory = vi.fn(() => stubProvider({ name: 'a' }));
    reg.register('a', factory);
    expect(factory).not.toHaveBeenCalled();
    reg.resolve('a');
    reg.resolve('a');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
