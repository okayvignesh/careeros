import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../types';
import { createAdzunaAdapter, mapAdzuna } from './adzuna';
import { MalformedResponseError, MissingCredentialError } from './errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__fixtures__', 'adapters', 'adzuna.json'), 'utf8'),
);

const CREDS = { appId: 'test-app-id', appKey: 'test-app-key' };
const SEARCH_URL = 'https://api.adzuna.com/v1/api/jobs/gb/search/1';

describe('adzuna adapter', () => {
  it('yields >=2 raw jobs on happy path', async () => {
    server.use(http.get(SEARCH_URL, () => HttpResponse.json(FIXTURE)));
    const adapter = createAdzunaAdapter({ credentials: CREDS, lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws.length).toBeGreaterThanOrEqual(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('adzuna');
  });

  it('sends app_id + app_key in the query string', async () => {
    let captured: URL | null = null;
    server.use(
      http.get(SEARCH_URL, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(FIXTURE);
      }),
    );
    const adapter = createAdzunaAdapter({ credentials: CREDS, lookup: fakeLookup });
    await adapter.fetch();
    expect(captured).not.toBeNull();
    expect(captured!.searchParams.get('app_id')).toBe('test-app-id');
    expect(captured!.searchParams.get('app_key')).toBe('test-app-key');
    expect(captured!.searchParams.get('results_per_page')).toBe('50');
  });

  it('throws MissingCredentialError at fetch time when env is unset (never at import)', async () => {
    // No handler needed — fails before any request.
    const priorId = process.env.ADZUNA_APP_ID;
    const priorKey = process.env.ADZUNA_APP_KEY;
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    try {
      const adapter = createAdzunaAdapter({ lookup: fakeLookup });
      await expect(adapter.fetch()).rejects.toBeInstanceOf(MissingCredentialError);
    } finally {
      if (priorId !== undefined) process.env.ADZUNA_APP_ID = priorId;
      if (priorKey !== undefined) process.env.ADZUNA_APP_KEY = priorKey;
    }
  });

  it('throws MalformedResponseError when the body is missing `results`', async () => {
    server.use(http.get(SEARCH_URL, () => HttpResponse.json({ nope: 1 })));
    const adapter = createAdzunaAdapter({
      credentials: CREDS,
      lookup: fakeLookup,
      retryAttempts: 1,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('yields zero rows on an empty search', async () => {
    server.use(http.get(SEARCH_URL, () => HttpResponse.json({ results: [], count: 0 })));
    const adapter = createAdzunaAdapter({ credentials: CREDS, lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });

  it('retries on 429 up to attempts=3 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(SEARCH_URL, () => {
        calls += 1;
        if (calls < 3) return HttpResponse.json({ message: 'too many' }, { status: 429 });
        return HttpResponse.json(FIXTURE);
      }),
    );
    const adapter = createAdzunaAdapter({
      credentials: CREDS,
      lookup: fakeLookup,
      retryAttempts: 3,
    });
    const raws = await adapter.fetch();
    expect(calls).toBe(3);
    expect(raws.length).toBeGreaterThan(0);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createAdzunaAdapter({
      credentials: CREDS,
      baseUrl: 'https://evil.example.com/v1/api/jobs',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapAdzuna', () => {
  it('drops rows missing id/title/url/description', () => {
    expect(
      mapAdzuna({ id: '', title: 't', description: 'd', redirect_url: 'https://x' }),
    ).toBeNull();
    expect(
      mapAdzuna({ id: '1', title: '', description: 'd', redirect_url: 'https://x' }),
    ).toBeNull();
    expect(mapAdzuna({ id: '1', title: 't', description: 'd', redirect_url: '' })).toBeNull();
    expect(mapAdzuna({ id: '1', title: 't', description: '', redirect_url: 'https://x' })).toBeNull();
  });

  it('detects remote from title/location/description text', () => {
    const raw = mapAdzuna({
      id: '1',
      title: 'Backend Engineer (Remote)',
      description: 'Work from anywhere.',
      redirect_url: 'https://x',
    });
    expect(raw!.remote).toBe(true);
  });

  it('falls back to "Unknown" when company.display_name is absent', () => {
    const raw = mapAdzuna({ id: '1', title: 't', description: 'd', redirect_url: 'https://x' });
    expect(raw!.company).toBe('Unknown');
  });
});
