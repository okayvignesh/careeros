import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { createFirecrawlClient, readFirecrawlApiKey, isFirecrawlConfigured } from './index';
import {
  FirecrawlApiError,
  FirecrawlConfigError,
  FirecrawlMalformedResponseError,
} from './errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const scrapeUrl = 'https://api.firecrawl.dev/v1/scrape';
const searchUrl = 'https://api.firecrawl.dev/v1/search';
const crawlUrl = 'https://api.firecrawl.dev/v1/crawl';

const client = (over: Record<string, unknown> = {}) =>
  createFirecrawlClient({
    apiKey: 'fc-test-key',
    lookup: fakeLookup,
    retryAttempts: 1,
    retryBaseMs: 1,
    ...over,
  });

const scrapeFixture = {
  success: true,
  data: {
    markdown: '# Senior Engineer\n\nApply now.',
    metadata: { title: 'Senior Engineer', sourceURL: 'https://acme.example/careers/1' },
  },
};

describe('FirecrawlClient.scrape', () => {
  it('returns typed data on the happy path', async () => {
    server.use(http.post(scrapeUrl, () => HttpResponse.json(scrapeFixture)));
    const res = await client().scrape({ url: 'https://acme.example/careers/1', formats: ['markdown'] });
    expect(res.success).toBe(true);
    expect(res.data.markdown).toContain('Senior Engineer');
    expect(res.data.metadata?.title).toBe('Senior Engineer');
  });

  it('throws FirecrawlApiError on a non-2xx API error', async () => {
    server.use(
      http.post(scrapeUrl, () =>
        HttpResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 }),
      ),
    );
    const err = await client()
      .scrape({ url: 'https://acme.example/careers/1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FirecrawlApiError);
    expect((err as FirecrawlApiError).status).toBe(401);
  });

  it('throws FirecrawlMalformedResponseError on a bad body shape', async () => {
    server.use(
      http.post(scrapeUrl, () =>
        HttpResponse.json({ success: true, data: { markdown: 123 } }),
      ),
    );
    await expect(
      client().scrape({ url: 'https://acme.example/careers/1' }),
    ).rejects.toBeInstanceOf(FirecrawlMalformedResponseError);
  });

  it('throws FirecrawlMalformedResponseError when the body is not JSON', async () => {
    server.use(http.post(scrapeUrl, () => new HttpResponse('not json', { status: 200 })));
    await expect(
      client().scrape({ url: 'https://acme.example/careers/1' }),
    ).rejects.toBeInstanceOf(FirecrawlMalformedResponseError);
  });

  it('retries a 429 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.post(scrapeUrl, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({ success: false, error: 'rate limited' }, { status: 429 });
        }
        return HttpResponse.json(scrapeFixture);
      }),
    );
    const res = await client({ retryAttempts: 3, retryBaseMs: 1 }).scrape({
      url: 'https://acme.example/careers/1',
    });
    expect(calls).toBe(3);
    expect(res.data.markdown).toContain('Senior Engineer');
  });

  it('rejects a non-allowlisted base via SsrfBlockedError, without retrying', async () => {
    let calls = 0;
    server.use(
      http.post('https://evil.example.com/v1/scrape', () => {
        calls += 1;
        return HttpResponse.json(scrapeFixture);
      }),
    );
    const err = await client({ baseUrl: 'https://evil.example.com/v1', retryAttempts: 3 })
      .scrape({ url: 'https://acme.example/careers/1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(calls).toBe(0);
  });
});

describe('FirecrawlClient.search', () => {
  it('returns typed results', async () => {
    server.use(
      http.post(searchUrl, () =>
        HttpResponse.json({
          success: true,
          data: [
            { url: 'https://acme.example/careers', title: 'Acme careers' },
            { url: 'https://beta.example/jobs', description: 'Beta jobs' },
          ],
        }),
      ),
    );
    const res = await client().search({ query: 'site:acme.example careers', limit: 5 });
    expect(res.data).toHaveLength(2);
    expect(res.data[0]?.url).toBe('https://acme.example/careers');
  });
});

describe('FirecrawlClient.crawl', () => {
  it('starts a crawl and reads its status', async () => {
    server.use(
      http.post(crawlUrl, () => HttpResponse.json({ success: true, id: 'job-42' })),
      http.get('https://api.firecrawl.dev/v1/crawl/job-42', () =>
        HttpResponse.json({
          status: 'completed',
          completed: 2,
          total: 2,
          data: [scrapeFixture.data, scrapeFixture.data],
        }),
      ),
    );
    const c = client();
    const job = await c.crawl({ url: 'https://acme.example/careers', limit: 10 });
    expect(job.id).toBe('job-42');
    const status = await c.getCrawlStatus(job.id);
    expect(status.status).toBe('completed');
    expect(status.data).toHaveLength(2);
  });
});

describe('Firecrawl config', () => {
  it('throws a typed config error when the key is missing', () => {
    expect(() => createFirecrawlClient({ env: {}, lookup: fakeLookup })).toThrow(
      FirecrawlConfigError,
    );
  });

  it('reads a trimmed key from env and reports configured state', () => {
    expect(readFirecrawlApiKey({ FIRECRAWL_API_KEY: '  fc-abc  ' })).toBe('fc-abc');
    expect(readFirecrawlApiKey({ FIRECRAWL_API_KEY: '   ' })).toBeNull();
    expect(readFirecrawlApiKey({})).toBeNull();
    expect(isFirecrawlConfigured({ FIRECRAWL_API_KEY: 'fc-abc' })).toBe(true);
    expect(isFirecrawlConfigured({})).toBe(false);
  });
});
