import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { OpenAICompatibleProvider, type LlmCallRecord } from './openai-compatible';
import { LLMProviderError, StructuredOutputError, TokenCapExceededError } from '../errors';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OPENAI_URL = 'https://api.openai.com/v1';

function makeProvider(onCall?: (r: LlmCallRecord) => void): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name: 'openai',
    apiKey: 'sk-test',
    baseUrl: OPENAI_URL,
    chatModel: 'gpt-4o-mini',
    // Never hit DNS in a unit test; validate against a known-public IP.
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    ...(onCall ? { onCall } : {}),
  });
}

describe('OpenAICompatibleProvider (msw)', () => {
  it('happy chat returns content and reports tokens via onCall', async () => {
    const records: LlmCallRecord[] = [];
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: 'pong' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
      ),
    );
    const p = makeProvider((r) => records.push(r));
    const out = await p.chat({ messages: [{ role: 'user', content: 'ping' }] });
    expect(out).toBe('pong');

    await new Promise((r) => setTimeout(r, 5));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      callKind: 'chat',
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
      ok: true,
    });
  });

  it('sends max_tokens (default 4096) and the configured model', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ choices: [{ message: { content: 'ok' } }] });
      }),
    );
    await makeProvider().chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(body['max_tokens']).toBe(4096);
    expect(body['model']).toBe('gpt-4o-mini');
  });

  it('honours a per-call maxTokens override', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ choices: [{ message: { content: 'ok' } }] });
      }),
    );
    await makeProvider().chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 128 });
    expect(body['max_tokens']).toBe(128);
  });

  it('maps a non-2xx upstream to LLMProviderError without leaking the message', async () => {
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'quota exceeded tenant xyz' } }, { status: 429 }),
      ),
    );
    let threw: unknown = null;
    try {
      await makeProvider().chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(LLMProviderError);
    const err = threw as LLMProviderError;
    expect(err.message).toBe('LLM provider error');
    expect(err.message).not.toContain('tenant');
    expect(err.upstream).toBe('quota exceeded tenant xyz');
  });

  it('retries structured output once with <schema-error> and succeeds', async () => {
    let calls = 0;
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        if (calls === 1) {
          return HttpResponse.json({ choices: [{ message: { content: '{"n":"bad"}' } }] });
        }
        const last = body.messages[body.messages.length - 1]?.content ?? '';
        expect(last).toContain('<schema-error>');
        return HttpResponse.json({ choices: [{ message: { content: '{"n":42}' } }] });
      }),
    );
    const out = await makeProvider().chatStructured({
      messages: [{ role: 'user', content: 'give n' }],
      schema: z.object({ n: z.number() }),
    });
    expect(out.n).toBe(42);
    expect(calls).toBe(2);
  });

  it('throws StructuredOutputError after the retry also fails', async () => {
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, () =>
        HttpResponse.json({ choices: [{ message: { content: '{"n":"still-bad"}' } }] }),
      ),
    );
    await expect(
      makeProvider().chatStructured({
        messages: [{ role: 'user', content: 'give n' }],
        schema: z.object({ n: z.number() }),
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('rejects an over-cap prompt pre-flight (no network egress)', async () => {
    // msw is set to `onUnhandledRequest: 'error'`; a fetch here would throw a
    // different error, so the TokenCapExceededError proves we short-circuited.
    const p = new OpenAICompatibleProvider({
      name: 'openai',
      apiKey: 'sk-test',
      baseUrl: OPENAI_URL,
      chatModel: 'gpt-4o-mini',
      maxInputTokens: 5,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    await expect(
      p.chat({ messages: [{ role: 'user', content: 'this is a much longer prompt' }] }),
    ).rejects.toBeInstanceOf(TokenCapExceededError);
  });

  it('stamps prompt context + validation on the audit row', async () => {
    const records: LlmCallRecord[] = [];
    server.use(
      http.post(`${OPENAI_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: '{"n":1}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      ),
    );
    const p = makeProvider((r) => records.push(r));
    await p.chatStructured({
      messages: [{ role: 'user', content: 'give n' }],
      schema: z.object({ n: z.number() }),
      meta: {
        promptId: 'test-prompt',
        promptVersion: '1.0.0',
        promptHash: 'abc123',
        sensitivity: 'personal',
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      promptId: 'test-prompt',
      promptVersion: '1.0.0',
      promptHash: 'abc123',
      sensitivity: 'personal',
      validation: 'passed',
    });
    expect(records[0]!.estimatedPromptTokens).toBeGreaterThan(0);
  });

  it('probe reports reachable on GET /models', async () => {
    server.use(http.get(`${OPENAI_URL}/models`, () => HttpResponse.json({ data: [] })));
    const r = await makeProvider().probe();
    expect(r.reachable).toBe(true);
  });

  it('rejects a private-IP baseUrl synchronously (SSRF guard)', () => {
    expect(
      () =>
        new OpenAICompatibleProvider({
          name: 'openai',
          apiKey: 'x',
          baseUrl: 'http://169.254.169.254/v1',
          chatModel: 'x',
        }),
    ).toThrow();
  });
});
