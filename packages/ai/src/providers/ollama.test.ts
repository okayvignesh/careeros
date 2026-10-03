import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { OllamaProvider } from './ollama';
import type { LlmCallRecord } from './openai-compatible';
import { LLMProviderError, StructuredOutputError } from '../errors';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OLLAMA_URL = 'http://localhost:11434';

function makeProvider(onCall?: (r: LlmCallRecord) => void): OllamaProvider {
  return new OllamaProvider({
    baseUrl: OLLAMA_URL,
    chatModel: 'llama3.1',
    ...(onCall ? { onCall } : {}),
  });
}

describe('OllamaProvider (msw, native /api/chat)', () => {
  it('happy chat returns content and maps prompt_eval_count/eval_count', async () => {
    let body: Record<string, unknown> = {};
    const records: LlmCallRecord[] = [];
    server.use(
      http.post(`${OLLAMA_URL}/api/chat`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          message: { role: 'assistant', content: 'pong' },
          prompt_eval_count: 5,
          eval_count: 3,
          done: true,
        });
      }),
    );
    const out = await makeProvider((r) => records.push(r)).chat({
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(out).toBe('pong');
    expect(body['stream']).toBe(false);
    expect((body['options'] as Record<string, unknown>)['num_predict']).toBe(4096);

    await new Promise((r) => setTimeout(r, 5));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      provider: 'ollama',
      model: 'llama3.1',
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      ok: true,
    });
  });

  it('structured output sends a JSON-schema format and validates the response', async () => {
    let format: unknown;
    server.use(
      http.post(`${OLLAMA_URL}/api/chat`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        format = body['format'];
        return HttpResponse.json({ message: { content: '{"n":7}' } });
      }),
    );
    const out = await makeProvider().chatStructured({
      messages: [{ role: 'user', content: 'give n' }],
      schema: z.object({ n: z.number() }),
    });
    expect(out.n).toBe(7);
    expect(format).toMatchObject({ type: 'object' });
  });

  it('retries structured output once on validation failure', async () => {
    let calls = 0;
    server.use(
      http.post(`${OLLAMA_URL}/api/chat`, async ({ request }) => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: { content: '{"n":"bad"}' } });
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        expect(body.messages[body.messages.length - 1]?.content).toContain('<schema-error>');
        return HttpResponse.json({ message: { content: '{"n":9}' } });
      }),
    );
    const out = await makeProvider().chatStructured({
      messages: [{ role: 'user', content: 'give n' }],
      schema: z.object({ n: z.number() }),
    });
    expect(out.n).toBe(9);
    expect(calls).toBe(2);
  });

  it('throws StructuredOutputError when the retry also fails', async () => {
    server.use(
      http.post(`${OLLAMA_URL}/api/chat`, () =>
        HttpResponse.json({ message: { content: 'not json' } }),
      ),
    );
    await expect(
      makeProvider().chatStructured({
        messages: [{ role: 'user', content: 'give n' }],
        schema: z.object({ n: z.number() }),
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('maps a non-2xx upstream to LLMProviderError without leaking details', async () => {
    server.use(
      http.post(`${OLLAMA_URL}/api/chat`, () =>
        HttpResponse.json({ error: 'model llama3.1 not found' }, { status: 404 }),
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
    expect(err.message).not.toContain('llama3.1');
    expect(err.upstream).toBe('model llama3.1 not found');
  });

  it('probe reports reachable on GET /api/tags', async () => {
    server.use(http.get(`${OLLAMA_URL}/api/tags`, () => HttpResponse.json({ models: [] })));
    const r = await makeProvider().probe();
    expect(r.reachable).toBe(true);
  });

  it('exposes honest local-model capabilities and no api key', () => {
    const p = makeProvider();
    expect(p.capabilities).toEqual({
      structuredOutput: true,
      streaming: false,
      toolUse: false,
      contextWindow: 8_192,
      embeddings: false,
    });
  });
});
