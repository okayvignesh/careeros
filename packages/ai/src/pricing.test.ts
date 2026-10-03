import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './pricing';

describe('estimateCostUsd', () => {
  it('prices DeepSeek chat and reasoner', () => {
    // 1M input + 1M output = inputPer1M + outputPer1M.
    expect(estimateCostUsd('deepseek', 'deepseek-chat', 1_000_000, 1_000_000)).toBeCloseTo(1.37);
    expect(estimateCostUsd('deepseek', 'deepseek-reasoner', 1_000_000, 0)).toBeCloseTo(0.55);
  });

  it('prices OpenAI models', () => {
    expect(estimateCostUsd('openai', 'gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75);
  });

  it('treats local Ollama inference as free for any model', () => {
    expect(estimateCostUsd('ollama', 'llama3.1', 10_000, 5_000)).toBe(0);
  });

  it('returns null for providers or models with no published rate', () => {
    expect(estimateCostUsd('openrouter', 'some/model', 1, 1)).toBeNull();
    expect(estimateCostUsd('openai', 'unreleased-model', 1, 1)).toBeNull();
  });
});
