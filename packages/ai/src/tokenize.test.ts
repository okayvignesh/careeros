import { describe, expect, it } from 'vitest';
import { encodingNameForModel, estimateMessagesTokens, estimateTokens } from './tokenize';

describe('encodingNameForModel', () => {
  it('maps the GPT-4o / o-series family to o200k_base', () => {
    expect(encodingNameForModel('gpt-4o')).toBe('o200k_base');
    expect(encodingNameForModel('gpt-4o-mini')).toBe('o200k_base');
    expect(encodingNameForModel('o3-mini')).toBe('o200k_base');
  });

  it('maps DeepSeek / GPT-4 / unknown models to cl100k_base', () => {
    expect(encodingNameForModel('deepseek-chat')).toBe('cl100k_base');
    expect(encodingNameForModel('gpt-4')).toBe('cl100k_base');
    expect(encodingNameForModel('llama3.1')).toBe('cl100k_base');
  });
});

describe('estimateTokens', () => {
  it('counts a known short string', () => {
    // tiktoken cl100k_base: "hello world" -> 2 tokens.
    expect(estimateTokens('hello world', 'deepseek-chat')).toBe(2);
  });

  it('returns 0 for empty / non-string input', () => {
    expect(estimateTokens('', 'deepseek-chat')).toBe(0);
    expect(estimateTokens(undefined as unknown as string, 'deepseek-chat')).toBe(0);
  });
});

describe('estimateMessagesTokens', () => {
  it('adds a per-message framing overhead on top of content tokens', () => {
    const msgs = [
      { role: 'system' as const, content: 'hello world' },
      { role: 'user' as const, content: 'hello world' },
    ];
    // 2 content tokens + 4 overhead, twice.
    expect(estimateMessagesTokens(msgs, 'deepseek-chat')).toBe(12);
  });

  it('is monotonic in content length', () => {
    const short = estimateMessagesTokens([{ role: 'user', content: 'a' }], 'gpt-4o');
    const long = estimateMessagesTokens(
      [{ role: 'user', content: 'a '.repeat(200) }],
      'gpt-4o',
    );
    expect(long).toBeGreaterThan(short);
  });
});
