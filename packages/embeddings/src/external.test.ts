// Contract tests for the OpenAI-compatible external embeddings adapter.
// A real `node:http` server stands in for the provider (no network, no msw
// dependency) so the test exercises the actual `fetch` client, retry policy,
// auth header, response parsing and dimension enforcement end-to-end.
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ExternalEmbeddingError,
  OpenAICompatibleEmbeddingProvider,
  createExternalEmbeddingProvider,
  validateExternalEmbeddingConfig,
  type ExternalEmbeddingConfig,
} from './external';
import { createEmbeddingProvider } from './provider';

interface StubServer {
  url: string;
  requests: Array<{ method: string; url: string; auth?: string; body: unknown }>;
  close: () => Promise<void>;
}

async function startStub(
  handler: (req: IncomingMessage, res: ServerResponse, attempts: number) => void,
): Promise<StubServer> {
  const requests: StubServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* leave as string */
      }
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
        body,
      });
      handler(req, res, requests.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const open: StubServer[] = [];
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open.length = 0;
});

function makeConfig(
  url: string,
  extra: Partial<ExternalEmbeddingConfig> = {},
): ExternalEmbeddingConfig {
  return {
    baseUrl: url,
    apiKey: 'sk-test-123',
    model: 'text-embedding-3-small',
    dimensions: 3,
    retry: { attempts: 3, baseMs: 1, maxMs: 5 },
    ...extra,
  };
}

describe('validateExternalEmbeddingConfig', () => {
  it('rejects a missing baseUrl / apiKey / model and bad URL', () => {
    expect(() =>
      validateExternalEmbeddingConfig({ ...makeConfig('http://x'), baseUrl: '' }),
    ).toThrow(ExternalEmbeddingError);
    expect(() =>
      validateExternalEmbeddingConfig({ ...makeConfig('http://x'), apiKey: ' ' }),
    ).toThrow(/apiKey is required/);
    expect(() => validateExternalEmbeddingConfig({ ...makeConfig('http://x'), model: '' })).toThrow(
      /model is required/,
    );
    expect(() => validateExternalEmbeddingConfig({ ...makeConfig('not a url') })).toThrow(
      /not a valid URL/,
    );
    expect(() =>
      validateExternalEmbeddingConfig({ ...makeConfig('http://x'), dimensions: 0 }),
    ).toThrow(/dimensions/);
  });
});

describe('OpenAICompatibleEmbeddingProvider', () => {
  it('POSTs model + input to {baseUrl}/embeddings with bearer auth and returns the vector', async () => {
    const stub = await startStub((_req, res) =>
      json(res, 200, { data: [{ embedding: [0.1, 0.2, 0.3] }], model: 'text-embedding-3-small' }),
    );
    open.push(stub);

    const provider = createExternalEmbeddingProvider(makeConfig(stub.url));
    const vec = await provider.embed('hello world');

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(provider.mode).toBe('external');
    expect(provider.model).toBe('text-embedding-3-small');
    expect(provider.dim).toBe(3);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.method).toBe('POST');
    expect(stub.requests[0]!.url).toBe('/v1/embeddings');
    expect(stub.requests[0]!.auth).toBe('Bearer sk-test-123');
    expect(stub.requests[0]!.body).toEqual({
      model: 'text-embedding-3-small',
      input: 'hello world',
    });
  });

  it('infers the dimension from the first response when none is configured', async () => {
    const stub = await startStub((_req, res) => json(res, 200, { data: [{ embedding: [1, 2] }] }));
    open.push(stub);
    const cfg = makeConfig(stub.url);
    delete cfg.dimensions;
    const provider = new OpenAICompatibleEmbeddingProvider(cfg);
    expect(provider.dim).toBe(0); // unknown until first call
    await provider.embed('a');
    expect(provider.dim).toBe(2);
  });

  it('throws on a dimension mismatch instead of writing a wrong-sized vector', async () => {
    const stub = await startStub((_req, res) => json(res, 200, { data: [{ embedding: [1, 2] }] }));
    open.push(stub);
    const provider = new OpenAICompatibleEmbeddingProvider(makeConfig(stub.url)); // expects 3
    await expect(provider.embed('a')).rejects.toThrow(/dimension mismatch/i);
    expect(stub.requests).toHaveLength(1);
  });

  it('fails fast on 4xx without retrying', async () => {
    const stub = await startStub((_req, res) =>
      json(res, 401, { error: { message: 'invalid api key' } }),
    );
    open.push(stub);
    const provider = new OpenAICompatibleEmbeddingProvider(makeConfig(stub.url));
    await expect(provider.embed('a')).rejects.toMatchObject({ status: 401 });
    expect(stub.requests).toHaveLength(1);
  });

  it('retries 5xx and succeeds on a later attempt', async () => {
    const stub = await startStub((_req, res, attempt) => {
      if (attempt < 3) return json(res, 503, { error: 'overloaded' });
      return json(res, 200, { data: [{ embedding: [0.5, 0.5, 0.5] }] });
    });
    open.push(stub);
    const provider = new OpenAICompatibleEmbeddingProvider(makeConfig(stub.url));
    await expect(provider.embed('a')).resolves.toEqual([0.5, 0.5, 0.5]);
    expect(stub.requests).toHaveLength(3);
  });

  it('exhausts retries and surfaces the final 5xx error', async () => {
    const stub = await startStub((_req, res) => json(res, 500, { error: 'boom' }));
    open.push(stub);
    const provider = new OpenAICompatibleEmbeddingProvider(makeConfig(stub.url));
    await expect(provider.embed('a')).rejects.toMatchObject({ status: 500 });
    expect(stub.requests).toHaveLength(3);
  });

  it('rejects a malformed (non-embedding) response', async () => {
    const stub = await startStub((_req, res) => json(res, 200, { data: [{ nope: true }] }));
    open.push(stub);
    const provider = new OpenAICompatibleEmbeddingProvider(makeConfig(stub.url));
    await expect(provider.embed('a')).rejects.toThrow(/malformed response/i);
    // Shape errors are not transient: exactly one request.
    expect(stub.requests).toHaveLength(1);
  });
});

describe('createEmbeddingProvider external seam', () => {
  it('builds the external adapter from externalConfig (no silent deterministic fallback)', async () => {
    const stub = await startStub((_req, res) =>
      json(res, 200, { data: [{ embedding: [9, 9, 9] }] }),
    );
    open.push(stub);
    const provider = createEmbeddingProvider({
      mode: 'external',
      externalConfig: makeConfig(stub.url),
    });
    expect(provider.mode).toBe('external');
    await expect(provider.embed('x')).resolves.toEqual([9, 9, 9]);
  });

  it('throws when the external config is invalid rather than degrading silently', () => {
    expect(() =>
      createEmbeddingProvider({
        mode: 'external',
        externalConfig: { baseUrl: '', apiKey: 'k', model: 'm' },
      }),
    ).toThrow(ExternalEmbeddingError);
  });
});
