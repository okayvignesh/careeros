import { describe, expect, it } from 'vitest';
import { SttUnavailableError, WhisperClient } from './whisper';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WhisperClient', () => {
  it('stays inert when WHISPER_URL is absent', async () => {
    const client = new WhisperClient({ url: '   ' });
    expect(client.configured).toBe(false);
    await expect(client.transcribe(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      SttUnavailableError,
    );
    expect(await client.health()).toMatchObject({ ok: false, status: 'unconfigured' });
  });

  it('parses a json transcript from /inference', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({ text: 'hello world' });
    }) as unknown as typeof fetch;

    const client = new WhisperClient({ url: 'http://whisper:4001/', fetchImpl: fakeFetch });
    const result = await client.transcribe(new Uint8Array([1, 2, 3]), { language: 'en' });

    expect(result.text).toBe('hello world');
    expect(calls[0]).toBe('http://whisper:4001/inference');
  });

  it('parses verbose_json segments', async () => {
    const fakeFetch = (async () =>
      jsonResponse({
        text: 'hello world',
        language: 'english',
        duration: 1.5,
        segments: [{ id: 0, start: 0, end: 1.5, text: 'hello world' }],
      })) as unknown as typeof fetch;

    const client = new WhisperClient({ url: 'http://whisper:4001', fetchImpl: fakeFetch });
    const result = await client.transcribe(new Uint8Array([1]), {
      responseFormat: 'verbose_json',
    });

    expect(result.language).toBe('english');
    expect(result.segments).toEqual([{ id: 0, start: 0, end: 1.5, text: 'hello world' }]);
  });

  it('maps /health 200 to ok and 503 to loading', async () => {
    let status = 200;
    const fakeFetch = (async () =>
      jsonResponse({ status: status === 200 ? 'ok' : 'loading model' }, status)) as unknown as typeof fetch;
    const client = new WhisperClient({ url: 'http://whisper:4001', fetchImpl: fakeFetch });

    expect(await client.health()).toMatchObject({ ok: true, status: 'ok' });
    status = 503;
    expect(await client.health()).toMatchObject({ ok: false, status: 'loading' });
  });

  it('reports unreachable instead of throwing when the server is down', async () => {
    const fakeFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new WhisperClient({ url: 'http://whisper:4001', fetchImpl: fakeFetch });

    expect(await client.health()).toMatchObject({ ok: false, status: 'unreachable' });
  });
});
