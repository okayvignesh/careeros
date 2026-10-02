import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { MissingCredentialError } from '../errors';
import {
  companyFromUrl,
  createFirecrawlAdapter,
  FIRECRAWL_TRUST_TIER,
  isBannedPlatformUrl,
  mapFirecrawl,
} from './index';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'firecrawl.json'), 'utf8'),
) as {
  search: unknown;
  scrapes: Record<string, unknown>;
};

const SEARCH_URL = 'https://api.firecrawl.dev/v1/search';
const SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';

const client = (over: Record<string, unknown> = {}) =>
  createFirecrawlAdapter({
    queries: ['site:careers.example engineer'],
    apiKey: 'fc-test-key',
    lookup: fakeLookup,
    retryAttempts: 1,
    retryBaseMs: 1,
    ...over,
  });

/** Scrape handler backed by the fixture, keyed on the posted target URL. */
function scrapeHandlers() {
  return http.post(SCRAPE_URL, async ({ request }) => {
    const body = (await request.json()) as { url?: string };
    const hit = body.url ? FIXTURE.scrapes[body.url] : undefined;
    return hit ? HttpResponse.json(hit) : HttpResponse.json({ success: false, error: 'miss' }, { status: 404 });
  });
}

describe('firecrawl adapter', () => {
  it('discovers jobs, scrapes details, and yields schema-valid RawJobs', async () => {
    server.use(http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)), scrapeHandlers());
    const adapter = client();
    expect(adapter.tier).toBe(3);
    const raws = await adapter.fetch();
    expect(raws).toHaveLength(3);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws.every((r) => r.sourceName === 'firecrawl')).toBe(true);
    expect(raws.every((r) => r.sourceId.startsWith('firecrawl:'))).toBe(true);
    expect(raws.every((r) => r.canonicalUrl.startsWith('https://'))).toBe(true);
  });

  it('never ingests banned platforms (LinkedIn/Indeed/Naukri/Glassdoor)', async () => {
    server.use(http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)), scrapeHandlers());
    const raws = await client().fetch();
    const hosts = raws.map((r) => new URL(r.canonicalUrl).hostname);
    expect(hosts.some((h) => h.includes('linkedin') || h.includes('indeed'))).toBe(false);
  });

  it('derives company from the ATS token / site host and ogSiteName', async () => {
    server.use(http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)), scrapeHandlers());
    const raws = await client().fetch();
    const byTitle = new Map(raws.map((r) => [r.title, r]));
    expect(byTitle.get('Senior Backend Engineer')?.company).toBe('acme');
    expect(byTitle.get('Product Designer')?.company).toBe('Beta Corp');
    expect(byTitle.get('Staff Site Reliability Engineer')?.company).toBe('gamma.example');
  });

  it('flags remote from listing text and marks DISCOVERED trust tier', async () => {
    server.use(http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)), scrapeHandlers());
    const raws = await client().fetch();
    const byTitle = new Map(raws.map((r) => [r.title, r]));
    expect(byTitle.get('Senior Backend Engineer')?.remote).toBe(true);
    expect(FIRECRAWL_TRUST_TIER).toBe('DISCOVERED');
  });

  it('works without scraping when scrapeDetails=false (search snippets only)', async () => {
    // No scrape handler registered: onUnhandledRequest=error would fail if scraped.
    server.use(http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)));
    const raws = await client({ scrapeDetails: false }).fetch();
    expect(raws).toHaveLength(3);
    expect(raws[0]?.description.length).toBeGreaterThan(0);
  });

  it('degrades to the search snippet when a single scrape fails', async () => {
    const failing = 'https://jobs.ashbyhq.com/acme/senior-backend-eng';
    server.use(
      http.post(SEARCH_URL, () => HttpResponse.json(FIXTURE.search)),
      http.post(SCRAPE_URL, async ({ request }) => {
        const body = (await request.json()) as { url?: string };
        if (body.url === failing) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        const hit = body.url ? FIXTURE.scrapes[body.url] : undefined;
        return hit ? HttpResponse.json(hit) : HttpResponse.json({ error: 'miss' }, { status: 404 });
      }),
    );
    const raws = await client().fetch();
    expect(raws).toHaveLength(3);
    const ashby = raws.find((r) => r.canonicalUrl === failing);
    expect(ashby?.description).toContain('distributed platform'); // from search description
  });

  it('throws MissingCredentialError at fetch time when no key/client is available', async () => {
    const adapter = createFirecrawlAdapter({
      queries: ['engineer'],
      env: {},
      lookup: fakeLookup,
      retryAttempts: 1,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it('returns [] without hitting the network when no queries are configured', async () => {
    server.use(http.post(SEARCH_URL, () => HttpResponse.error()));
    const adapter = createFirecrawlAdapter({ queries: [], apiKey: 'x', lookup: fakeLookup });
    expect(await adapter.fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = client({ baseUrl: 'https://evil.example.com/v1' });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapFirecrawl / helpers', () => {
  it('drops a result with an unusable URL', () => {
    expect(mapFirecrawl({ url: 'not-a-url' })).toBeNull();
  });

  it('drops a result with no title', () => {
    expect(mapFirecrawl({ url: 'https://acme.example/jobs/1' })).toBeNull();
  });

  it('isBannedPlatformUrl covers subdomains and rejects unparseable URLs', () => {
    expect(isBannedPlatformUrl('https://www.linkedin.com/jobs/view/1')).toBe(true);
    expect(isBannedPlatformUrl('https://uk.indeed.com/viewjob')).toBe(true);
    expect(isBannedPlatformUrl('https://www.glassdoor.co.uk/Job/x')).toBe(true);
    expect(isBannedPlatformUrl('https://jobs.ashbyhq.com/acme/x')).toBe(false);
    expect(isBannedPlatformUrl('nope')).toBe(true);
  });

  it('companyFromUrl handles ATS tokens, Workday tenants, and generic career hosts', () => {
    expect(companyFromUrl('https://jobs.ashbyhq.com/acme/1')).toBe('acme');
    expect(companyFromUrl('https://boards.greenhouse.io/beta/jobs/2')).toBe('beta');
    expect(companyFromUrl('https://pvh.wd1.myworkdayjobs.com/en-US/PVH_Careers/job/x')).toBe('pvh');
    expect(companyFromUrl('https://careers.gamma.example/roles/x')).toBe('gamma.example');
  });
});
