// Assert-based self-check for DeepseekProvider hardening (A-H5).
// Run: npx tsx packages/ai/src/providers/deepseek.demo.ts
import assert from 'node:assert/strict';
import { z } from 'zod';
import { DeepSeekProvider } from './deepseek';
import { StructuredOutputError } from '../errors';

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
  return { restore: () => ((globalThis as unknown as { fetch: typeof fetch }).fetch = original), calls };
}

function label(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`ok ${name}`);
    });
}

async function main(): Promise<void> {
  await label('chatStructured sends max_tokens (default 4096) in body', async () => {
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
      assert.equal(out.n, 1);
      assert.equal(calls[0]?.body?.['max_tokens'], 4096);
    } finally {
      restore();
    }
  });

  await label('chatStructured respects per-call maxTokens override', async () => {
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
      assert.equal(calls[0]?.body?.['max_tokens'], 256);
    } finally {
      restore();
    }
  });

  await label('chatStructured retries once with <schema-error> on Zod failure, succeeds on retry', async () => {
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
      assert.equal(out.n, 42);
      assert.equal(calls.length, 2);
      const retryMessages = (calls[1]?.body?.['messages'] ?? []) as Array<{ content: string }>;
      const last = retryMessages[retryMessages.length - 1]?.content ?? '';
      assert(last.includes('<schema-error>'), 'retry prompt should carry the schema-error tag');
    } finally {
      restore();
    }
  });

  await label('chatStructured throws StructuredOutputError after second failure', async () => {
    // Mutation smoke: if retry silently returns partial output, this expectation fails.
    const bad = new Response(
      JSON.stringify({ choices: [{ message: { content: '{"n": "still-bad"}' } }], usage: {} }),
      { status: 200 },
    );
    const { restore } = stubFetch([() => bad.clone(), () => bad.clone()]);
    try {
      const p = new DeepSeekProvider({ apiKey: 'x', chatModel: 'test' });
      let threw: unknown = null;
      try {
        await p.chatStructured({
          messages: [{ role: 'user', content: 'ok' }],
          schema: z.object({ n: z.number() }),
        });
      } catch (err) {
        threw = err;
      }
      assert(threw instanceof StructuredOutputError, 'expected StructuredOutputError');
    } finally {
      restore();
    }
  });

  await label('constructor rejects a private-IP baseUrl synchronously (SSRF)', () => {
    // Mutation smoke: if assertPublicUrlShape check is removed, no throw.
    let threw = false;
    try {
      new DeepSeekProvider({
        apiKey: 'x',
        chatModel: 'test',
        baseUrl: 'http://169.254.169.254/v1',
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  });

  // eslint-disable-next-line no-console
  console.log('\nall deepseek hardening checks passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
