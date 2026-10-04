import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { buildMarketSyncRequests, type MarketPlan } from '../stages/market-plan';
import { createAdzunaAdapter } from './adzuna';
import { createFirecrawlAdapter, type FirecrawlJobClient } from './firecrawl';

/**
 * Scrape-scope acceptance (job-targeting §11): the outbound request SET equals
 * the market plan per country, and non-target countries get zero calls.
 */
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const CREDS = { appId: 'test-app-id', appKey: 'test-app-key' };
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__fixtures__', 'adapters', 'adzuna.json'), 'utf8'),
);

const PLAN: MarketPlan = {
  targets: [{ country: 'DE' }, { country: 'US', location: 'Austin' }],
  queries: ['backend engineer jobs'],
};

describe('Adzuna market scoping (msw)', () => {
  it('calls exactly the plan countries and never a non-target country', async () => {
    const seen: string[] = [];
    server.use(
      http.get('https://api.adzuna.com/v1/api/jobs/:country/search/1', ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.pathname);
        return HttpResponse.json(FIXTURE);
      }),
    );

    const requests = buildMarketSyncRequests('adzuna', PLAN);
    for (const request of requests) {
      const adapter = createAdzunaAdapter({
        credentials: CREDS,
        lookup: fakeLookup,
        country: request.country,
        ...(request.location ? { where: request.location } : {}),
      });
      await adapter.fetch();
    }

    expect(seen).toEqual([
      '/v1/api/jobs/de/search/1',
      '/v1/api/jobs/us/search/1',
    ]);
    // Non-target country: no handler + onUnhandledRequest:'error' would throw,
    // and the explicit assertion pins the intent.
    expect(seen.some((p) => p.includes('/gb/'))).toBe(false);
  });

  it('forwards the `where` filter for a city target', async () => {
    let where: string | null = null;
    server.use(
      http.get('https://api.adzuna.com/v1/api/jobs/us/search/1', ({ request }) => {
        where = new URL(request.url).searchParams.get('where');
        return HttpResponse.json(FIXTURE);
      }),
    );
    await createAdzunaAdapter({
      credentials: CREDS,
      lookup: fakeLookup,
      country: 'us',
      where: 'Austin',
    }).fetch();
    expect(where).toBe('Austin');
  });
});

describe('Firecrawl market scoping', () => {
  it('sends structured country/location on every search request, one per target', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client: FirecrawlJobClient = {
      search: async (req) => {
        calls.push(req as unknown as Record<string, unknown>);
        return { success: true, data: [] };
      },
      scrape: async () => ({ success: true, data: {} }),
    };

    const requests = buildMarketSyncRequests('firecrawl', PLAN);
    for (const request of requests) {
      const adapter = createFirecrawlAdapter({
        queries: PLAN.queries,
        country: request.country,
        ...(request.location ? { location: request.location } : {}),
        client,
      });
      await adapter.fetch();
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ query: 'backend engineer jobs', country: 'de' });
    expect(calls[1]).toMatchObject({
      query: 'backend engineer jobs',
      country: 'us',
      location: 'Austin',
    });
    expect(calls.map((c) => c.country)).not.toContain('gb');
  });
});
