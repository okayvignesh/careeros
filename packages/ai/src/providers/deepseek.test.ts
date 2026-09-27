import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeepSeekProvider } from './deepseek';
import { LLMProviderError, StructuredOutputError } from '../errors';

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(handlers: Array<(call: FetchCall) => Response | Promise<Response>>): {
  restore: () => void;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let idx = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call: FetchCall = { url, body };
    calls.push(call);
    const h = handlers[Math.min(idx, handlers.length - 1)];
    idx++;
    if (!h) throw new Error('no more stub handlers');
    return h(call);
  }) as typeof fetch;
  return {
    restore: () => ((globalThis as unknown as { fetch: typeof fetch }).fetch = original),
    calls,
  };
}

describe('DeepSeekProvider hardening (A-H5 + A-L1 + A-C2)', () => {
  it('chatStructured sends max_tokens (default 4096) in body', async () => {
    // Mutation smoke: drop max_tokens from body -> this fails.
    const { restore, calls } = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"n": 1}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    ]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      const out = await p.chatStructured({
        messages: [{ role: 'user', content: 'ok' }],
        schema: z.object({ n: z.number() }),
      });
      expect(out.n).toBe(1);
      expect(calls[0]?.body?.['max_tokens']).toBe(4096);
    } finally {
      restore();
    }
  });

  it('chatStructured respects per-call maxTokens override', async () => {
    const { restore, calls } = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"n": 2}' } }],
            usage: {},
          }),
          { status: 200 },
        ),
    ]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      await p.chatStructured({
        messages: [{ role: 'user', content: 'ok' }],
        schema: z.object({ n: z.number() }),
        maxTokens: 256,
      });
      expect(calls[0]?.body?.['max_tokens']).toBe(256);
    } finally {
      restore();
    }
  });

  it('chatStructured retries once with <schema-error> tag on Zod failure, succeeds on retry', async () => {
    // Mutation smoke: remove the retry -> first call throws StructuredOutputError immediately.
    const { restore, calls } = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"n": "not-a-number"}' } }],
            usage: {},
          }),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"n": 42}' } }],
            usage: {},
          }),
          { status: 200 },
        ),
    ]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      const out = await p.chatStructured({
        messages: [{ role: 'user', content: 'ok' }],
        schema: z.object({ n: z.number() }),
      });
      expect(out.n).toBe(42);
      expect(calls.length).toBe(2);
      const retryMessages = (calls[1]?.body?.['messages'] ?? []) as Array<{ content: string }>;
      const last = retryMessages[retryMessages.length - 1]?.content ?? '';
      expect(last).toContain('<schema-error>');
    } finally {
      restore();
    }
  });

  it('chatStructured throws StructuredOutputError after second failure', async () => {
    const bad = new Response(
      JSON.stringify({ choices: [{ message: { content: '{"n": "still-bad"}' } }], usage: {} }),
      { status: 200 },
    );
    const { restore } = stubFetch([() => bad.clone(), () => bad.clone()]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      await expect(
        p.chatStructured({
          messages: [{ role: 'user', content: 'ok' }],
          schema: z.object({ n: z.number() }),
        }),
      ).rejects.toBeInstanceOf(StructuredOutputError);
    } finally {
      restore();
    }
  });

  it('non-2xx upstream throws LLMProviderError with hidden .upstream (A-L1)', async () => {
    // Mutation smoke: if upstream string leaks into message, .message === "LLM provider error" fails.
    const { restore } = stubFetch([
      () =>
        new Response(
          JSON.stringify({ error: { message: 'model tenant xyz over quota' } }),
          { status: 429 },
        ),
    ]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      let threw: unknown = null;
      try {
        await p.chat({ messages: [{ role: 'user', content: 'x' }] });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(LLMProviderError);
      const err = threw as LLMProviderError;
      // Client-facing message MUST NOT contain upstream text.
      expect(err.message).toBe('LLM provider error');
      expect(err.message).not.toContain('tenant');
      // Server-side hook can still read the raw upstream.
      expect(err.upstream).toBe('model tenant xyz over quota');
      // Non-enumerable: JSON.stringify does not leak it.
      expect(JSON.stringify(err)).not.toContain('tenant');
    } finally {
      restore();
    }
  });

  it('constructor rejects a private-IP baseUrl synchronously (SSRF, A-C2)', () => {
    // Mutation smoke: if assertPublicUrlShape check is removed, no throw.
    expect(
      () =>
        new DeepSeekProvider({
          apiKey: 'x',
          chatModel: 'test',
          baseUrl: 'http://169.254.169.254/v1',
        }),
    ).toThrow();
  });
});
