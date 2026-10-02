import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { createLeverAdapter, inferLeverRemote, mapLever } from './index';
import { MalformedResponseError } from '../errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'lever.json'), 'utf8'),
) as unknown[];

const BASE = 'https://api.lever.co/v0/postings';

describe('lever adapter', () => {
  it('yields >=2 schema-valid RawJobs with correct provenance', async () => {
    server.use(http.get(`${BASE}/acme`, () => HttpResponse.json(FIXTURE)));
    const raws = await createLeverAdapter({ sites: ['acme'], lookup: fakeLookup }).fetch();
    expect(raws.length).toBeGreaterThanOrEqual(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('lever');
    expect(raws[0]?.sourceId).toContain('acme:');
    expect(raws[0]?.canonicalUrl).toMatch(/^https:\/\//);
  });

  it('paginates with skip/limit until a short page', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/acme`, ({ request }) => {
        calls += 1;
        const url = new URL(request.url);
        const skip = Number(url.searchParams.get('skip') ?? '0');
        const limit = Number(url.searchParams.get('limit') ?? '100');
        const page = Array.from({ length: Math.max(0, Math.min(limit, 5 - skip)) }, (_, i) => ({
          id: `${skip + i}`,
          text: `Role ${skip + i}`,
          hostedUrl: `https://jobs.lever.co/acme/${skip + i}`,
        }));
        return HttpResponse.json(page);
      }),
    );
    const raws = await createLeverAdapter({
      sites: ['acme'],
      lookup: fakeLookup,
      pageSize: 2,
      maxPages: 5,
    }).fetch();
    expect(raws).toHaveLength(5);
    expect(calls).toBe(3);
    expect(new Set(raws.map((r) => r.sourceId)).size).toBe(5);
  });

  it('throws MalformedResponseError when the body is not a posting array', async () => {
    server.use(http.get(`${BASE}/acme`, () => HttpResponse.json({ jobs: [] })));
    await expect(
      createLeverAdapter({ sites: ['acme'], lookup: fakeLookup, retryAttempts: 1 }).fetch(),
    ).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/acme`, () => {
        calls += 1;
        if (calls < 3) return HttpResponse.json({}, { status: 429 });
        return HttpResponse.json(FIXTURE);
      }),
    );
    const raws = await createLeverAdapter({
      sites: ['acme'],
      lookup: fakeLookup,
      retryAttempts: 3,
    }).fetch();
    expect(calls).toBe(3);
    expect(raws.length).toBeGreaterThan(0);
  });

  it('returns [] without hitting the network when no sites are configured', async () => {
    server.use(http.get(`${BASE}/*`, () => HttpResponse.error()));
    expect(await createLeverAdapter({ sites: [], lookup: fakeLookup }).fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createLeverAdapter({
      sites: ['acme'],
      baseUrl: 'https://evil.example.com/v0/postings',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapLever / helpers', () => {
  it('drops rows missing id/title/url', () => {
    expect(mapLever({ id: '', text: 't' }, 'acme')).toBeNull();
    expect(mapLever({ id: '1', text: '' }, 'acme')).toBeNull();
    expect(mapLever({ id: '1', text: 't' }, 'acme')).toBeNull();
  });

  it('maps epoch createdAt, workplaceType, and sourceId', () => {
    const raw = mapLever(
      {
        id: 'abc',
        text: 'Eng',
        categories: { location: 'Remote — Americas' },
        createdAt: 1499363737955,
        hostedUrl: 'https://jobs.lever.co/acme/abc',
        descriptionPlain: 'work',
        workplaceType: 'remote',
      },
      'acme',
      'Acme Inc',
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceId).toBe('acme:abc');
    expect(raw!.company).toBe('Acme Inc');
    expect(raw!.remote).toBe(true);
    expect(raw!.sourcePostedAt).toEqual(new Date(1499363737955));
  });

  it('inferLeverRemote trusts workplaceType over the text heuristic', () => {
    expect(inferLeverRemote('remote', '')).toBe(true);
    expect(inferLeverRemote('hybrid', 'remote team')).toBe(false);
    expect(inferLeverRemote('onsite', '')).toBe(false);
    expect(inferLeverRemote(undefined, 'Work from anywhere')).toBe(true);
    expect(inferLeverRemote(undefined, 'New York, NY')).toBe(false);
  });
});
