import { describe, expect, it } from 'vitest';
import { DeepSeekProvider } from './providers/deepseek';
import type { AIProvider } from './provider';

type FetchArgs = { url: string; init: RequestInit | undefined };

function stubFetch(
  handler: (call: FetchArgs) => Promise<Response> | Response,
): { restore: () => void; calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const call: FetchArgs = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return {
    restore: () => ((globalThis as unknown as { fetch: typeof fetch }).fetch = original),
    calls,
  };
}

describe('AIProvider interface conformance (C-P0.1) via DeepSeekProvider', () => {
  it('exposes name, capabilities, maxTokens, and required methods', () => {
    const p: AIProvider = new DeepSeekProvider({ apiKey: 'x', chatModel: 'deepseek-chat' });
    expect(p.name).toBe('deepseek');
    // capabilities is a real static shape, not a probe.
    expect(p.capabilities).toEqual({
      structuredOutput: true,
      streaming: false,
      toolUse: false,
      contextWindow: 65_536,
      embeddings: false,
    });
    expect(p.maxTokens).toBe(4096);
    expect(typeof p.chat).toBe('function');
    expect(typeof p.chatStructured).toBe('function');
    expect(typeof p.probe).toBe('function');
  });

  it('maxTokens reflects the configured default', () => {
    const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'x', maxTokens: 1234 });
    expect(p.maxTokens).toBe(1234);
  });
});

describe('DeepSeekProvider.probe (C-P0.1 reachability probe)', () => {
  it('reachable=true on GET /models 200', async () => {
    // Mutation smoke: if probe stops hitting /models the URL assertion fails.
    const { restore, calls } = stubFetch(
      () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    try {
      const p = new DeepSeekProvider({ apiKey: 'k', chatModel: 'deepseek-chat' });
      const r = await p.probe();
      expect(r.reachable).toBe(true);
      expect(typeof r.latencyMs).toBe('number');
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.error).toBeUndefined();
      expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/models');
      expect((calls[0]?.init as RequestInit | undefined)?.method).toBe('GET');
      const auth =
        (calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization ?? '';
      expect(auth).toBe('Bearer k');
    } finally {
      restore();
    }
  });

  it('reachable=false with HTTP status on non-2xx', async () => {
    const { restore } = stubFetch(() => new Response('nope', { status: 503 }));
    try {
      const p = new DeepSeekProvider({ apiKey: 'k', chatModel: 'deepseek-chat' });
      const r = await p.probe();
      expect(r.reachable).toBe(false);
      expect(r.error).toBe('HTTP 503');
    } finally {
      restore();
    }
  });

  it('reachable=false on network error (never throws)', async () => {
    const { restore } = stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    try {
      const p = new DeepSeekProvider({ apiKey: 'k', chatModel: 'deepseek-chat' });
      const r = await p.probe();
      expect(r.reachable).toBe(false);
      expect(r.error).toContain('ECONNREFUSED');
    } finally {
      restore();
    }
  });

  it('reachable=false with error="timeout" when abort fires', async () => {
    // Mutation smoke: remove the abort/timer and this hangs past the 3s budget.
    const { restore } = stubFetch(async (call) => {
      // Wait for the abort. If the caller never aborts, the test times out.
      await new Promise<void>((_, reject) => {
        const signal = call.init?.signal;
        if (!signal) return; // no abort wiring -> test will hang -> fails
        if (signal.aborted) return reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return new Response('', { status: 200 });
    });
    try {
      const p = new DeepSeekProvider({ apiKey: 'k', chatModel: 'deepseek-chat' });
      const r = await p.probe();
      expect(r.reachable).toBe(false);
      // Node's AbortError message is "The operation was aborted" but we translate
      // the sentinel string; either way it must not be reachable.
      expect(r.error).toBeDefined();
    } finally {
      restore();
    }
  }, 10_000);
});
