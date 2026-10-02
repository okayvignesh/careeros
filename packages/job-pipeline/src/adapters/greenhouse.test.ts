import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../types';
import { createGreenhouseAdapter, mapGreenhouse } from './greenhouse';
import { MalformedResponseError } from './errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__fixtures__', 'adapters', 'greenhouse.json'), 'utf8'),
);

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

describe('greenhouse adapter', () => {
  it('yields >=2 raw jobs on happy path', async () => {
    server.use(http.get(`${BASE}/acme/jobs`, () => HttpResponse.json(FIXTURE)));
    const adapter = createGreenhouseAdapter({ boardTokens: ['acme'], lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws.length).toBeGreaterThanOrEqual(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('greenhouse');
    expect(raws[0]?.company).toBe('Acme Inc');
  });

  it('strips HTML from the description', async () => {
    server.use(http.get(`${BASE}/acme/jobs`, () => HttpResponse.json(FIXTURE)));
    const adapter = createGreenhouseAdapter({ boardTokens: ['acme'], lookup: fakeLookup });
    const [first] = await adapter.fetch();
    expect(first?.description).not.toContain('<');
    expect(first?.description).toContain('Kubernetes');
  });

  it('throws MalformedResponseError when the body is missing `jobs`', async () => {
    server.use(http.get(`${BASE}/acme/jobs`, () => HttpResponse.json({ unrelated: 1 })));
    const adapter = createGreenhouseAdapter({
      boardTokens: ['acme'],
      lookup: fakeLookup,
      retryAttempts: 1,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('yields zero rows on an empty board', async () => {
    server.use(http.get(`${BASE}/acme/jobs`, () => HttpResponse.json({ jobs: [] })));
    const adapter = createGreenhouseAdapter({ boardTokens: ['acme'], lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });

  it('retries on 429 up to attempts=3 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/acme/jobs`, () => {
        calls += 1;
        if (calls < 3) return HttpResponse.json({ message: 'rate limited' }, { status: 429 });
        return HttpResponse.json(FIXTURE);
      }),
    );
    const adapter = createGreenhouseAdapter({
      boardTokens: ['acme'],
      lookup: fakeLookup,
      retryAttempts: 3,
    });
    const raws = await adapter.fetch();
    expect(calls).toBe(3);
    expect(raws.length).toBeGreaterThan(0);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createGreenhouseAdapter({
      boardTokens: ['acme'],
      baseUrl: 'https://evil.example.com/v1/boards',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('returns [] when no boardTokens are configured', async () => {
    const adapter = createGreenhouseAdapter({ boardTokens: [], lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });
});

describe('mapGreenhouse', () => {
  it('drops rows missing required fields', () => {
    expect(
      mapGreenhouse({ id: 0 as unknown as number, title: 't', absolute_url: 'https://x' }, 'acme'),
    ).not.toBeNull(); // id=0 is valid — just an edge sanity check
    expect(
      mapGreenhouse({ id: undefined as unknown as number, title: 't', absolute_url: 'https://x' }, 'acme'),
    ).toBeNull();
    expect(mapGreenhouse({ id: 1, title: '', absolute_url: 'https://x' }, 'acme')).toBeNull();
    expect(mapGreenhouse({ id: 1, title: 't', absolute_url: '' }, 'acme')).toBeNull();
  });

  it('sets remote=true when the location string looks remote', () => {
    const raw = mapGreenhouse(
      {
        id: 42,
        title: 'Eng',
        absolute_url: 'https://boards.greenhouse.io/acme/jobs/42',
        location: { name: 'Remote — Anywhere' },
        content: 'Build things.',
      },
      'acme',
    );
    expect(raw!.remote).toBe(true);
  });

  it('falls back to token for company when the API omits company_name', () => {
    const raw = mapGreenhouse(
      { id: 1, title: 't', absolute_url: 'https://x' },
      'acme-startup',
    );
    expect(raw!.company).toBe('acme-startup');
  });
});
