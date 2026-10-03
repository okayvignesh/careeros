import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CircuitBreaker, FallbackProvider } from './fallback';
import { LLMProviderError, StructuredOutputError } from '../errors';
import type { AIProvider, ProviderCapabilities } from '../provider';

const CAPS: ProviderCapabilities = {
  structuredOutput: true,
  streaming: false,
  toolUse: false,
  contextWindow: 4096,
  embeddings: false,
};

function fake(
  name: string,
  overrides: Partial<Pick<AIProvider, 'chat' | 'chatStructured' | 'probe'>> = {},
): AIProvider {
  return {
    name,
    capabilities: CAPS,
    chat: async () => `${name}-chat`,
    chatStructured: (async () => ({ from: name })) as AIProvider['chatStructured'],
    probe: async () => ({ reachable: true, latencyMs: 0 }),
    ...overrides,
  };
}

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures and half-opens after the cooldown', () => {
    const breaker = new CircuitBreaker(2, 1_000);
    breaker.recordFailure('p', 0);
    expect(breaker.isOpen('p', 0)).toBe(false);
    breaker.recordFailure('p', 0);
    expect(breaker.isOpen('p', 500)).toBe(true);
    expect(breaker.status('p', 500).retryAt).toBe(1_000);
    // Cooldown elapsed -> half-open (not open) so the next call probes.
    expect(breaker.isOpen('p', 1_000)).toBe(false);
    // A success clears the counter.
    breaker.recordFailure('p', 2_000);
    breaker.recordSuccess('p');
    expect(breaker.status('p', 2_000)).toEqual({ failures: 0, open: false, retryAt: null });
  });
});

describe('FallbackProvider (primary -> backup -> local Ollama)', () => {
  it('falls through to the backup on an availability failure and flags degraded', async () => {
    const primary = fake('deepseek', {
      chat: async () => {
        throw new LLMProviderError('LLM provider error', 'down');
      },
    });
    const backup = fake('openai');
    const onFallback = vi.fn();
    const fp = new FallbackProvider([primary, backup], { onFallback });

    await expect(fp.chat({ messages: [] })).resolves.toBe('openai-chat');
    expect(fp.degraded).toBe(true);
    expect(fp.activeProvider).toBe('openai');
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ activeProvider: 'openai', primaryProvider: 'deepseek' }),
    );
  });

  it('skips a provider once its breaker is open (load-per-call breaker reuse)', async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    const primaryChat = vi.fn(async () => {
      throw new LLMProviderError('LLM provider error', 'down');
    });
    const primary = fake('deepseek', { chat: primaryChat });
    const backup = fake('openai');
    const fp = new FallbackProvider([primary, backup], { breaker, keyPrefix: 'u1' });

    await fp.chat({ messages: [] });
    await fp.chat({ messages: [] });
    expect(breaker.isOpen('u1:deepseek')).toBe(true);

    await fp.chat({ messages: [] });
    // Third call never touched the open primary.
    expect(primaryChat).toHaveBeenCalledTimes(2);
  });

  it('does not route around structured-output failures', async () => {
    const primary = fake('deepseek', {
      chatStructured: (async () => {
        throw new StructuredOutputError('bad json');
      }) as AIProvider['chatStructured'],
    });
    const backupStructured = vi.fn(async () => ({ from: 'backup' }));
    const backup = fake('openai', {
      chatStructured: backupStructured as unknown as AIProvider['chatStructured'],
    });
    const fp = new FallbackProvider([primary, backup]);

    await expect(
      fp.chatStructured({ messages: [], schema: z.object({}) }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(backupStructured).not.toHaveBeenCalled();
  });

  it('throws the last error when every candidate is unavailable', async () => {
    const primary = fake('deepseek', {
      chat: async () => {
        throw new LLMProviderError('LLM provider error', 'p-down');
      },
    });
    const backup = fake('ollama', {
      chat: async () => {
        throw new LLMProviderError('LLM provider error', 'o-down');
      },
    });
    const fp = new FallbackProvider([primary, backup]);
    await expect(fp.chat({ messages: [] })).rejects.toBeInstanceOf(LLMProviderError);
  });

  it('probe returns the first reachable candidate', async () => {
    const primary = fake('deepseek', {
      probe: async () => ({ reachable: false, latencyMs: 1, error: 'down' }),
    });
    const backup = fake('ollama', {
      probe: async () => ({ reachable: true, latencyMs: 2 }),
    });
    const fp = new FallbackProvider([primary, backup]);
    await expect(fp.probe()).resolves.toMatchObject({ reachable: true, latencyMs: 2 });
  });
});
