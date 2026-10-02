import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { createSmartRecruitersAdapter, mapSmartRecruiters } from './index';
import { MalformedResponseError } from '../errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'smartrecruiters.json'),
    'utf8',
  ),
) as { content: Array<Record<string, unknown>> };

const BASE = 'https://api.smartrecruiters.com/v1/companies';
const LIST = `${BASE}/acme/postings`;

describe('smartrecruiters adapter', () => {
  it('lists + details postings, mapping schema-valid RawJobs', async () => {
    server.use(
      http.get(LIST, () => HttpResponse.json(FIXTURE)),
      http.get(`${LIST}/744000148454651`, () =>
        HttpResponse.json(FIXTURE.content[0]),
      ),
      // Second detail fails → mapper falls back to the list row.
      http.get(`${LIST}/744000148400000`, () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );
    const raws = await createSmartRecruitersAdapter({
      companyIds: ['acme'],
      lookup: fakeLookup,
      retryAttempts: 1,
    }).fetch();
    expect(raws).toHaveLength(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();

    expect(raws[0]?.sourceName).toBe('smartrecruiters');
    expect(raws[0]?.sourceId).toContain('acme:');
    expect(raws[0]?.company).toBe('SmartRecruiters Inc');
    expect(raws[0]?.remote).toBe(true);
    expect(raws[0]?.description).toContain('technical engineer');
    expect(raws[1]?.title).toBe('Senior Software Engineer');
    expect(raws[1]?.remote).toBe(false);
  });

  it('paginates with offset until offset >= totalFound', async () => {
    let calls = 0;
    server.use(
      http.get(LIST, ({ request }) => {
        calls += 1;
        const params = new URL(request.url).searchParams;
        const offset = Number(params.get('offset') ?? '0');
        const limit = Number(params.get('limit') ?? '100');
        const remaining = Math.max(0, 5 - offset);
        const content = Array.from({ length: Math.min(limit, remaining) }, (_, i) => ({
          id: `${offset + i}`,
          name: `Role ${offset + i}`,
        }));
        return HttpResponse.json({ offset, limit, totalFound: 5, content });
      }),
    );
    const raws = await createSmartRecruitersAdapter({
      companyIds: ['acme'],
      lookup: fakeLookup,
      pageSize: 2,
      maxPages: 5,
      fetchDetails: false,
    }).fetch();
    expect(raws).toHaveLength(5);
    expect(calls).toBe(3);
    expect(new Set(raws.map((r) => r.sourceId)).size).toBe(5);
  });

  it('throws MalformedResponseError when the list shape is invalid', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ offset: 0 })));
    await expect(
      createSmartRecruitersAdapter({
        companyIds: ['acme'],
        lookup: fakeLookup,
        retryAttempts: 1,
        fetchDetails: false,
      }).fetch(),
    ).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('returns [] without hitting the network when no companies are configured', async () => {
    server.use(http.get(`${BASE}/*`, () => HttpResponse.error()));
    expect(
      await createSmartRecruitersAdapter({ companyIds: [], lookup: fakeLookup }).fetch(),
    ).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createSmartRecruitersAdapter({
      companyIds: ['acme'],
      baseUrl: 'https://evil.example.com/v1/companies',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapSmartRecruiters', () => {
  it('drops rows with no id or name (returns null)', () => {
    expect(mapSmartRecruiters({ id: '', name: 't' }, 'acme')).toBeNull();
    expect(mapSmartRecruiters({ id: '1', name: '  ' }, 'acme')).toBeNull();
  });

  it('builds the canonical job URL from the posting id when no postingUrl is present', () => {
    const raw = mapSmartRecruiters({ id: '42', name: 'Eng' }, 'acme');
    expect(raw!.canonicalUrl).toBe('https://jobs.smartrecruiters.com/acme/42');
    expect(raw!.sourceId).toBe('acme:42');
  });

  it('flattens flat jobAd sections into a plain-text description', () => {
    const raw = mapSmartRecruiters(
      {
        id: '42',
        name: 'Eng',
        jobAd: {
          jobDescription: '<p>Do the work</p>',
          qualifications: '<p>You can code</p>',
        },
      },
      'acme',
    );
    expect(raw!.description).toContain('Do the work');
    expect(raw!.description).toContain('You can code');
  });
});
