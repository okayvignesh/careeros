import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../registry';
import { createProvider, registerBuiltinProviders } from './create';
import { DeepSeekProvider } from './deepseek';
import { OpenAICompatibleProvider } from './openai-compatible';
import { OllamaProvider } from './ollama';

describe('createProvider', () => {
  it('builds the DeepSeek adapter', () => {
    const p = createProvider({ provider: 'deepseek', apiKey: 'sk', chatModel: 'deepseek-chat' });
    expect(p).toBeInstanceOf(DeepSeekProvider);
    expect(p.name).toBe('deepseek');
  });

  it('builds OpenAI and OpenRouter via the OpenAI-compatible adapter', () => {
    const openai = createProvider({ provider: 'openai', apiKey: 'sk', chatModel: 'gpt-4o-mini' });
    expect(openai).toBeInstanceOf(OpenAICompatibleProvider);
    expect(openai.name).toBe('openai');

    const openrouter = createProvider({
      provider: 'openrouter',
      apiKey: 'sk',
      chatModel: 'openai/gpt-4o-mini',
    });
    expect(openrouter).toBeInstanceOf(OpenAICompatibleProvider);
    expect(openrouter.name).toBe('openrouter');
  });

  it('builds Ollama with no key', () => {
    const p = createProvider({ provider: 'ollama', chatModel: 'llama3.1' });
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it('rejects an unknown provider id', () => {
    expect(() => createProvider({ provider: 'anthropic', chatModel: 'x' })).toThrow(
      /Unsupported provider/,
    );
  });

  it('requires a baseUrl for a custom OpenAI-compatible endpoint', () => {
    expect(() => createProvider({ provider: 'custom', chatModel: 'x' })).toThrow(/requires a baseUrl/);
  });
});

describe('registerBuiltinProviders', () => {
  it('registers every shipped adapter idempotently with real capabilities', () => {
    const registry = new ProviderRegistry();
    registerBuiltinProviders(registry);
    registerBuiltinProviders(registry); // no duplicate-registration throw

    const infos = registry.list();
    expect(infos.map((i) => i.name).sort()).toEqual(['deepseek', 'ollama', 'openai', 'openrouter']);
    const caps = Object.fromEntries(infos.map((i) => [i.name, i.capabilities]));
    expect(caps['ollama']?.contextWindow).toBe(8_192);
    expect(caps['openai']?.contextWindow).toBe(128_000);
    expect(caps['deepseek']?.structuredOutput).toBe(true);
  });
});
