import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { MalformedResponseError, MissingCredentialError } from '../errors';
import {
  createIcimsAdapter,
  mapIcims,
  parseIcimsDate,
  titleFromPortalUrl,
} from './index';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'icims.json'), 'utf8'),
) as { searchResults: unknown[] };

const BASE = 'https://api.icims.com/customers';
const LIST = `${BASE}/acme/search/portals/jobs`;

const adapter = (over: Record<string, unknown> = {}) =>
  createIcimsAdapter({
    customerId: 'acme',
    portalId: 'jobs',
    user: 'svc-user',
    password: 'svc-pass',
    lookup: fakeLookup,
    retryAttempts: 1,
    ...over,
  });

describe('icims adapter', () => {
  it('lists portal jobs, mapping schema-valid RawJobs derived from portalUrl', async () => {
    server.use(http.get(LIST, () => HttpResponse.json(FIXTURE)));
    const raws = await adapter().fetch();
    expect(raws).toHaveLength(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('icims');
    expect(raws[0]?.sourceId).toBe('acme:1709');
    expect(raws[0]?.title).toBe('Customer Service Representative');
    expect(raws[0]?.company).toBe('acme');
    expect(raws[0]?.canonicalUrl).toContain('icims.com');
  });

  it('sends Basic auth and paginates until a short page', async () => {
    let calls = 0;
    let auth: string | null = null;
    server.use(
      http.get(LIST, ({ request }) => {
        calls += 1;
        auth = request.headers.get('authorization');
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        const pageSize = Number(new URL(request.url).searchParams.get('pageSize') ?? '100');
        const remaining = Math.max(0, 5 - (page - 1) * pageSize);
        const rows = Array.from({ length: Math.min(pageSize, remaining) }, (_, i) => {
          const id = (page - 1) * pageSize + i + 1;
          return {
            id,
            portalUrl: `https://jobs.acme.icims.com/jobs/${id}/role-${id}/job`,
            updatedDate: '2026-09-30 02:07 PM',
          };
        });
        return HttpResponse.json({ searchResults: rows });
      }),
    );
    const raws = await adapter({ pageSize: 2, maxPages: 5 }).fetch();
    expect(raws).toHaveLength(5);
    expect(calls).toBe(3);
    expect(auth).toBe(`Basic ${Buffer.from('svc-user:svc-pass').toString('base64')}`);
  });

  it('throws MissingCredentialError at fetch time when Basic creds are absent', async () => {
    server.use(http.get(LIST, () => HttpResponse.error()));
    const a = adapter({ user: '', password: '' });
    await expect(a.fetch()).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it('throws MalformedResponseError when searchResults is missing', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ jobs: [] })));
    await expect(adapter().fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('returns [] without hitting the network when customer/portal are unset', async () => {
    server.use(http.get(`${BASE}/*`, () => HttpResponse.error()));
    const a = createIcimsAdapter({ customerId: '', portalId: '', lookup: fakeLookup });
    expect(await a.fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const a = adapter({ baseUrl: 'https://evil.example.com/customers' });
    await expect(a.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('promotes to tier 1 only when the portal is explicitly verified', () => {
    expect(adapter().tier).toBe(2);
    expect(adapter({ verified: true }).tier).toBe(1);
  });
});

describe('icims helpers', () => {
  it('titleFromPortalUrl extracts and title-cases the slug', () => {
    expect(
      titleFromPortalUrl('https://jobs.acme.icims.com/jobs/1709/customer-service-representative/job'),
    ).toBe('Customer Service Representative');
    expect(titleFromPortalUrl('not-a-url')).toBeNull();
  });

  it('parseIcimsDate tolerates prose-local dates and rejects garbage', () => {
    expect(parseIcimsDate('2026-09-30T14:07:00Z')).toEqual(new Date('2026-09-30T14:07:00Z'));
    expect(parseIcimsDate('not a date')).toBeNull();
  });

  it('mapIcims drops rows with no id or unusable portal URL', () => {
    expect(mapIcims({ portalUrl: 'https://x.icims.com/jobs/1/a/job' } as never, 'acme')).toBeNull();
    expect(mapIcims({ id: 1, portalUrl: 'nope' } as never, 'acme')).toBeNull();
  });
});
