import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { MalformedResponseError } from '../errors';
import {
  createWorkdayAdapter,
  inferWorkdayRemote,
  mapWorkday,
  parseWorkdayPosted,
} from './index';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURES_DIR = join(__dirname, '..', '..', '..', '__fixtures__', 'adapters');
const LIST = JSON.parse(readFileSync(join(FIXTURES_DIR, 'workday-list.json'), 'utf8')) as {
  total: number;
  jobPostings: Array<{ externalPath: string; title: string }>;
};
const DETAIL = JSON.parse(readFileSync(join(FIXTURES_DIR, 'workday-detail.json'), 'utf8'));

const HOST = 'acme.wd5.myworkdayjobs.com';
const API = `https://${HOST}/wday/cxs/acme/External`;
const JOBS_URL = `${API}/jobs`;
const NOW = new Date('2026-10-02T12:00:00Z');

const adapter = (over: Record<string, unknown> = {}) =>
  createWorkdayAdapter({
    host: HOST,
    tenant: 'acme',
    site: 'External',
    lookup: fakeLookup,
    retryAttempts: 1,
    now: NOW,
    ...over,
  });

describe('workday adapter', () => {
  it('lists + details postings, mapping schema-valid RawJobs', async () => {
    server.use(
      http.post(JOBS_URL, () => HttpResponse.json(LIST)),
      http.get(`${API}/job/Remote/Senior-Backend-Engineer_R1001`, () => HttpResponse.json(DETAIL)),
      // Second detail fails → mapper falls back to the list row.
      http.get(`${API}/job/New-York-NY/Product-Designer_R1002`, () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );
    const a = adapter();
    expect(a.tier).toBe(2);
    const raws = await a.fetch();
    expect(raws).toHaveLength(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();

    const [eng, designer] = raws;
    expect(eng?.sourceName).toBe('workday');
    expect(eng?.title).toBe('Senior Backend Engineer');
    expect(eng?.company).toBe('Acme Inc');
    expect(eng?.canonicalUrl).toBe(
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Backend-Engineer_R1001',
    );
    expect(eng?.remote).toBe(true);
    expect(eng?.sourcePostedAt).toEqual(new Date('2026-09-28'));
    expect(eng?.description).toContain('distributed platform');

    expect(designer?.title).toBe('Product Designer');
    expect(designer?.company).toBe('acme'); // tenant fallback, detail unavailable
    expect(designer?.canonicalUrl).toBe(
      `https://${HOST}/en-US/External/job/New-York-NY/Product-Designer_R1002`,
    );
    expect(designer?.remote).toBe(false);
    expect(designer?.sourcePostedAt).toEqual(new Date('2026-09-29T12:00:00Z'));
  });

  it('paginates until offset >= total', async () => {
    let calls = 0;
    server.use(
      http.post(JOBS_URL, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { offset: number; limit: number };
        const jobPostings = Array.from({ length: body.limit }, (_, i) => ({
          title: `Role ${body.offset + i}`,
          externalPath: `/job/Role-${body.offset + i}_R${body.offset + i}`,
          postedOn: 'Posted Today',
          bulletFields: [`R${body.offset + i}`],
        }));
        return HttpResponse.json({ total: 40, jobPostings, facets: [] });
      }),
    );
    const raws = await adapter({ fetchDetails: false, pageSize: 20, maxPages: 5 }).fetch();
    expect(raws).toHaveLength(40);
    expect(calls).toBe(2);
    expect(new Set(raws.map((r) => r.sourceId)).size).toBe(40);
  });

  it('forwards searchText and appliedFacets in the list body', async () => {
    let captured: unknown = null;
    server.use(
      http.post(JOBS_URL, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ total: 0, jobPostings: [], facets: [] });
      }),
    );
    await adapter({
      fetchDetails: false,
      searchText: 'engineer',
      appliedFacets: { Location_Country: ['abc'] },
    }).fetch();
    expect(captured).toMatchObject({
      searchText: 'engineer',
      appliedFacets: { Location_Country: ['abc'] },
    });
  });

  it('throws MalformedResponseError when the list shape is invalid', async () => {
    server.use(http.post(JOBS_URL, () => HttpResponse.json({ total: 2 })));
    await expect(adapter({ fetchDetails: false }).fetch()).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });

  it('returns [] without hitting the network when host/tenant/site are unset', async () => {
    server.use(http.post(JOBS_URL, () => HttpResponse.error()));
    const a = createWorkdayAdapter({ host: '', tenant: '', site: '', lookup: fakeLookup });
    expect(await a.fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const a = adapter({ baseUrl: 'https://evil.example.com/wday/cxs/acme/External' });
    await expect(a.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('promotes to tier 1 only when the board is explicitly verified', () => {
    expect(adapter().tier).toBe(2);
    expect(adapter({ verified: true }).tier).toBe(1);
  });
});

describe('workday helpers', () => {
  it('parseWorkdayPosted prefers startDate, then parses prose, else null', () => {
    expect(parseWorkdayPosted('2026-09-28', 'Posted Today', NOW)).toEqual(new Date('2026-09-28'));
    expect(parseWorkdayPosted(undefined, 'Posted Today', NOW)).toEqual(NOW);
    expect(parseWorkdayPosted(undefined, 'Posted Yesterday', NOW)).toEqual(
      new Date('2026-10-01T12:00:00Z'),
    );
    expect(parseWorkdayPosted(undefined, 'Posted 30+ Days Ago', NOW)).toEqual(
      new Date('2026-09-02T12:00:00Z'),
    );
    expect(parseWorkdayPosted(undefined, 'Posted Recently', NOW)).toBeNull();
    expect(parseWorkdayPosted(undefined, undefined, NOW)).toBeNull();
  });

  it('inferWorkdayRemote treats Flex/Onsite as not remote and heuristics otherwise', () => {
    expect(inferWorkdayRemote('Remote', '')).toBe(true);
    expect(inferWorkdayRemote('Flex', 'Remote team')).toBe(false);
    expect(inferWorkdayRemote('Onsite', '')).toBe(false);
    expect(inferWorkdayRemote(undefined, 'Work from anywhere')).toBe(true);
    expect(inferWorkdayRemote(undefined, 'New York, NY')).toBe(false);
  });

  it('mapWorkday drops rows with no title or externalPath', () => {
    const ctx = { host: HOST, tenant: 'acme', site: 'External', locale: 'en-US' };
    expect(mapWorkday({ title: '', externalPath: '/job/x' }, null, ctx)).toBeNull();
    expect(mapWorkday({ title: 'Eng', externalPath: '' }, null, ctx)).toBeNull();
  });
});
