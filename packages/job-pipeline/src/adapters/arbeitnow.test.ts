import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../types';
import { createArbeitnowAdapter, mapArbeitnow } from './arbeitnow';
import { MalformedResponseError } from './errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__fixtures__', 'adapters', 'arbeitnow.json'), 'utf8'),
);

const FEED_URL = 'https://www.arbeitnow.com/api/job-board-api';

describe('arbeitnow adapter', () => {
  it('yields >=2 raw jobs on happy path', async () => {
    server.use(http.get(FEED_URL, () => HttpResponse.json(FIXTURE)));
    const adapter = createArbeitnowAdapter({ lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws.length).toBeGreaterThanOrEqual(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('arbeitnow');
  });

  it('maps unix-seconds created_at to a Date', async () => {
    server.use(http.get(FEED_URL, () => HttpResponse.json(FIXTURE)));
    const adapter = createArbeitnowAdapter({ lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws[0]?.sourcePostedAt).toBeInstanceOf(Date);
    // 1758369600 = 2025-09-20T12:00:00Z
    expect(raws[0]?.sourcePostedAt?.toISOString()).toBe('2025-09-20T12:00:00.000Z');
  });

  it('throws MalformedResponseError when the body is missing `data`', async () => {
    server.use(http.get(FEED_URL, () => HttpResponse.json({ meta: {} })));
    const adapter = createArbeitnowAdapter({ lookup: fakeLookup, retryAttempts: 1 });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('yields zero rows on an empty feed', async () => {
    server.use(http.get(FEED_URL, () => HttpResponse.json({ data: [] })));
    const adapter = createArbeitnowAdapter({ lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });

  it('retries on 429 up to attempts=3 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(FEED_URL, () => {
        calls += 1;
        if (calls < 3) return HttpResponse.json({ message: 'slow down' }, { status: 429 });
        return HttpResponse.json(FIXTURE);
      }),
    );
    const adapter = createArbeitnowAdapter({ lookup: fakeLookup, retryAttempts: 3 });
    const raws = await adapter.fetch();
    expect(calls).toBe(3);
    expect(raws.length).toBeGreaterThan(0);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createArbeitnowAdapter({
      baseUrl: 'https://evil.example.com/api/job-board-api',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapArbeitnow', () => {
  it('drops rows missing slug/url/title/company', () => {
    expect(
      mapArbeitnow({
        slug: '',
        company_name: 'c',
        title: 't',
        description: 'd',
        remote: true,
        url: 'https://x',
      }),
    ).toBeNull();
    expect(
      mapArbeitnow({
        slug: 's',
        company_name: '',
        title: 't',
        description: 'd',
        remote: true,
        url: 'https://x',
      }),
    ).toBeNull();
    expect(
      mapArbeitnow({
        slug: 's',
        company_name: 'c',
        title: '',
        description: 'd',
        remote: true,
        url: 'https://x',
      }),
    ).toBeNull();
    expect(
      mapArbeitnow({
        slug: 's',
        company_name: 'c',
        title: 't',
        description: 'd',
        remote: true,
        url: '',
      }),
    ).toBeNull();
  });

  it('propagates the remote boolean verbatim from upstream', () => {
    const raw = mapArbeitnow({
      slug: 's',
      company_name: 'c',
      title: 't',
      description: 'd',
      remote: false,
      url: 'https://x',
    });
    expect(raw!.remote).toBe(false);
  });
});
