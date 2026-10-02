import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../types';
import { createAshbyAdapter, mapAshby } from './ashby';
import { MalformedResponseError } from './errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Fixed lookup shim — every allowlisted host resolves to a public IP so
// `assertPublicUrl` does not hit real DNS and does not reject on private-IP rules.
const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__fixtures__', 'adapters', 'ashby.json'), 'utf8'),
);

const BASE = 'https://api.ashbyhq.com/posting-api/job-board';

describe('ashby adapter', () => {
  it('yields >=2 raw jobs on happy path and each one validates against RawJobSchema', async () => {
    server.use(http.get(`${BASE}/acme`, () => HttpResponse.json(FIXTURE)));
    const adapter = createAshbyAdapter({ orgIds: ['acme'], lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws.length).toBeGreaterThanOrEqual(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    // Provenance intact.
    expect(raws[0]?.sourceName).toBe('ashby');
    expect(raws[0]?.sourceId).toContain('acme:');
    expect(raws[0]?.canonicalUrl).toMatch(/^https:\/\//);
  });

  it('throws MalformedResponseError when the body is missing `jobs`', async () => {
    server.use(http.get(`${BASE}/acme`, () => HttpResponse.json({ garbage: true })));
    const adapter = createAshbyAdapter({ orgIds: ['acme'], lookup: fakeLookup, retryAttempts: 1 });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('yields zero rows on an empty board', async () => {
    server.use(http.get(`${BASE}/acme`, () => HttpResponse.json({ jobs: [] })));
    const adapter = createAshbyAdapter({ orgIds: ['acme'], lookup: fakeLookup });
    const raws = await adapter.fetch();
    expect(raws).toEqual([]);
  });

  it('retries on 429 up to attempts=3 then succeeds when the mock flips to 200', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/acme`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({ message: 'rate limited' }, { status: 429 });
        }
        return HttpResponse.json(FIXTURE);
      }),
    );
    const adapter = createAshbyAdapter({ orgIds: ['acme'], lookup: fakeLookup, retryAttempts: 3 });
    const raws = await adapter.fetch();
    expect(calls).toBe(3);
    expect(raws.length).toBeGreaterThan(0);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError from assertPublicUrl', async () => {
    // No MSW handler needed — safeFetch throws before the request goes out.
    const adapter = createAshbyAdapter({
      orgIds: ['acme'],
      baseUrl: 'https://evil.example.com/posting-api/job-board',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('returns [] when no orgIds are configured (does not hit network)', async () => {
    // Force any outbound to fail so we can assert we did not fetch.
    server.use(http.get(`${BASE}/*`, () => HttpResponse.error()));
    const adapter = createAshbyAdapter({ orgIds: [], lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });
});

describe('mapAshby', () => {
  it('drops rows missing url/title/id (returns null)', () => {
    expect(mapAshby({ id: '', title: 't', location: '', jobUrl: 'https://x' }, 'acme')).toBeNull();
    expect(mapAshby({ id: '1', title: '', location: '', jobUrl: 'https://x' }, 'acme')).toBeNull();
    expect(mapAshby({ id: '1', title: 't', location: '', jobUrl: '' }, 'acme')).toBeNull();
  });

  it('produces a RawJob with sourceId=orgId:id and remote flag from isRemote', () => {
    const raw = mapAshby(
      {
        id: 'abc',
        title: 'Eng',
        location: 'Remote',
        isRemote: true,
        descriptionPlain: 'work',
        publishedAt: '2026-09-01T00:00:00Z',
        jobUrl: 'https://jobs.ashbyhq.com/acme/abc',
      },
      'acme',
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceId).toBe('acme:abc');
    expect(raw!.remote).toBe(true);
    expect(raw!.sourcePostedAt).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('sets sourcePostedAt=null on unparseable publishedAt', () => {
    const raw = mapAshby(
      { id: 'a', title: 't', location: '', jobUrl: 'https://x', publishedAt: 'nope' },
      'acme',
    );
    expect(raw!.sourcePostedAt).toBeNull();
  });
});
