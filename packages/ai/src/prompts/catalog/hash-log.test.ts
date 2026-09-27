import { afterEach, describe, expect, it, vi } from 'vitest';
import { logPromptUse, setPromptUseHook, type PromptUseEvent } from './hash-log';
import { PromptRegistry, type Prompt } from './registry';

const samplePrompt: Prompt = {
  id: 'sample',
  version: '1.0.0',
  template: 'system\n\nuser {{x}}',
};

afterEach(() => {
  setPromptUseHook(null);
});

describe('logPromptUse (C-P0.2)', () => {
  it('calls the injected hook with correct payload including hash when prompt is passed', () => {
    const seen: PromptUseEvent[] = [];
    setPromptUseHook((e) => seen.push(e));
    logPromptUse({
      promptId: 'sample',
      version: '1.0.0',
      callerModule: 'resume-variants.service',
      prompt: samplePrompt,
    });
    expect(seen).toHaveLength(1);
    const evt = seen[0]!;
    expect(evt.code).toBe('ai.prompt.use');
    expect(evt.promptId).toBe('sample');
    expect(evt.version).toBe('1.0.0');
    expect(evt.callerModule).toBe('resume-variants.service');
    expect(evt.hash).toBe(PromptRegistry.hashOf(samplePrompt));
    expect(evt.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  });

  it('emits empty hash string when prompt is not supplied (id-only log)', () => {
    const hook = vi.fn();
    setPromptUseHook(hook);
    logPromptUse({
      promptId: 'sample',
      version: '1.0.0',
      callerModule: 'x',
    });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![0].hash).toBe('');
  });

  it('is a no-op when no hook registered (does not throw)', () => {
    expect(() =>
      logPromptUse({ promptId: 'sample', version: '1.0.0', callerModule: 'x' }),
    ).not.toThrow();
  });

  it('swallows hook exceptions so audit failures never break the LLM call', () => {
    setPromptUseHook(() => {
      throw new Error('sink down');
    });
    expect(() =>
      logPromptUse({ promptId: 'sample', version: '1.0.0', callerModule: 'x' }),
    ).not.toThrow();
  });

  it('setPromptUseHook(null) clears the hook', () => {
    const hook = vi.fn();
    setPromptUseHook(hook);
    setPromptUseHook(null);
    logPromptUse({ promptId: 'sample', version: '1.0.0', callerModule: 'x' });
    expect(hook).not.toHaveBeenCalled();
  });
});
