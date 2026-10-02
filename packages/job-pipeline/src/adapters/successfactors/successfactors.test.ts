import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { MalformedResponseError, MissingCredentialError } from '../errors';
import { createSuccessFactorsAdapter, mapSuccessFactors } from './index';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'successfactors.json'),
    'utf8',
  ),
) as { d: { results: unknown[] } };

const HOST = 'acme.successfactors.com';
const ODATA = `https://${HOST}/odata/v2/JobRequisition`;

const adapter = (over: Record<string, unknown> = {}) =>
  createSuccessFactorsAdapter({
    apiHost: HOST,
    companyId: 'acme',
    user: 'sfadmin',
    password: 'sfpass',
    careerSiteUrl: 'https://careers.acme.com',
    companyName: 'Acme Inc',
    lookup: fakeLookup,
    retryAttempts: 1,
    ...over,
  });

describe('successfactors adapter', () => {
  it('lists JobRequisitions, mapping schema-valid RawJobs', async () => {
    server.use(http.get(ODATA, () => HttpResponse.json(FIXTURE)));
    const raws = await adapter().fetch();
    expect(raws).toHaveLength(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('successfactors');
    expect(raws[0]?.sourceId).toBe('acme:10042');
    expect(raws[0]?.title).toBe('Senior Backend Engineer');
    expect(raws[0]?.company).toBe('Acme Inc');
    expect(raws[0]?.canonicalUrl).toBe('https://careers.acme.com/job/10042/');
    expect(raws[0]?.remote).toBe(true);
    expect(raws[0]?.sourcePostedAt).toEqual(new Date('2026-09-20T08:00:00Z'));
    expect(raws[1]?.remote).toBe(false);
  });

  it('sends Basic auth and paginates with $skip/$top until a short page', async () => {
    let calls = 0;
    let auth: string | null = null;
    server.use(
      http.get(ODATA, ({ request }) => {
        calls += 1;
        auth = request.headers.get('authorization');
        const url = new URL(request.url);
        const skip = Number(url.searchParams.get('$skip') ?? '0');
        const top = Number(url.searchParams.get('$top') ?? '100');
        const remaining = Math.max(0, 5 - skip);
        const results = Array.from({ length: Math.min(top, remaining) }, (_, i) => ({
          jobReqId: String(skip + i + 1),
          jobTitle: `Role ${skip + i + 1}`,
        }));
        return HttpResponse.json({ d: { results } });
      }),
    );
    const raws = await adapter({ pageSize: 2, maxPages: 5 }).fetch();
    expect(raws).toHaveLength(5);
    expect(calls).toBe(3);
    expect(auth).toBe(`Basic ${Buffer.from('sfadmin@acme:sfpass').toString('base64')}`);
  });

  it('throws MissingCredentialError at fetch time when creds are absent', async () => {
    server.use(http.get(ODATA, () => HttpResponse.error()));
    const a = adapter({ user: '', password: '' });
    await expect(a.fetch()).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it('throws MalformedResponseError when d.results is missing', async () => {
    server.use(http.get(ODATA, () => HttpResponse.json({ d: {} })));
    await expect(adapter().fetch()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('returns [] without hitting the network when host/company are unset', async () => {
    server.use(http.get(`${ODATA}/*`, () => HttpResponse.error()));
    const a = createSuccessFactorsAdapter({ apiHost: '', companyId: '', lookup: fakeLookup });
    expect(await a.fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const a = adapter({ baseUrl: 'https://evil.example.com' });
    await expect(a.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('promotes to tier 1 only when the tenant is explicitly verified', () => {
    expect(adapter().tier).toBe(2);
    expect(adapter({ verified: true }).tier).toBe(1);
  });
});

describe('mapSuccessFactors', () => {
  it('drops rows with no jobReqId', () => {
    expect(mapSuccessFactors({ jobReqId: '' } as never, 'acme')).toBeNull();
    expect(mapSuccessFactors({ jobReqId: undefined } as never, 'acme')).toBeNull();
  });

  it('falls back to a requisition title and the API host when no career site is set', () => {
    const raw = mapSuccessFactors({ jobReqId: 7 }, 'acme', { apiHost: 'api4.successfactors.com' });
    expect(raw!.title).toBe('Requisition 7');
    expect(raw!.canonicalUrl).toBe('https://api4.successfactors.com/job/7');
    expect(raw!.description).toBe('Requisition 7');
  });
});
