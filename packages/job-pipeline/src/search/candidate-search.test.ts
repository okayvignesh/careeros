import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlJobClient } from '../adapters/firecrawl';
import { RawJobSchema } from '../types';
import { runCandidateSearch } from './candidate-search';

interface FakeHit {
  url: string;
  title?: string;
  description?: string;
}

function fakeClient(searches: Record<string, FakeHit[]>, scrapes: Record<string, string> = {}) {
  const search = vi.fn(async ({ query }: { query: string }) => ({
    success: true as const,
    data: searches[query] ?? [],
  }));
  const scrape = vi.fn(async ({ url }: { url: string }) => ({
    success: true as const,
    data: { markdown: scrapes[url] ?? '', metadata: { title: 'Scraped Title' } },
  }));
  return { client: { search, scrape } as unknown as FirecrawlJobClient, search, scrape };
}

const DEV = `https://jobs.lever.co/acme/123`;
const ATS = `https://boards.greenhouse.io/globex/jobs/456`;

describe('runCandidateSearch', () => {
  it('maps hits to RawJobs, keeps now-permitted platforms, and dedupes canonical URLs', async () => {
    const { client } = fakeClient({
      'q1': [
        { url: DEV, title: 'Senior Backend Engineer', description: 'Build things with TypeScript.' },
        { url: ATS, title: 'Platform Engineer', description: 'Own the platform.' },
        { url: 'https://www.linkedin.com/jobs/view/1', title: 'LinkedIn role', description: 'kept' },
        // Duplicate canonical URL (tracking param variant resolves same path here).
        { url: DEV, title: 'Senior Backend Engineer', description: 'Build things with TypeScript.' },
      ],
      'q2': [{ url: ATS, title: 'Platform Engineer', description: 'Own the platform.' }],
    });

    const out = await runCandidateSearch({ client, queries: ['q1', 'q2'] });

    expect(out.queriesRun).toBe(2);
    expect(out.hitsScanned).toBe(5);
    expect(out.bannedSkipped).toBe(0);
    // DEV + ATS + LinkedIn (q2 duplicate dropped).
    expect(out.raw).toHaveLength(3);
    expect(out.raw.some((r) => r.canonicalUrl.includes('linkedin.com'))).toBe(true);
    expect(out.duplicatesDropped).toBe(2);
    expect(out.calls.search).toBe(2);
    expect(out.calls.scrape).toBe(0);
    for (const r of out.raw) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(out.raw.every((r) => r.sourceName === 'firecrawl')).toBe(true);
  });

  it('scrapes details only when enabled, within the scrape cap, and never counts failures', async () => {
    const { client, scrape } = fakeClient(
      {
        q1: [
          { url: DEV, title: 'A', description: 'aaa' },
          { url: ATS, title: 'B', description: 'bbb' },
        ],
      },
      { [DEV]: '# Scraped Role\n\nfull description text' },
    );
    scrape.mockRejectedValueOnce(new Error('firecrawl 500'));

    const out = await runCandidateSearch({
      client,
      queries: ['q1'],
      scrapeDetails: true,
      maxScrapes: 1,
    });

    // Cap of 1 means the second scrape is never attempted.
    expect(out.calls.scrape).toBe(1);
    expect(out.raw).toHaveLength(2);
  });

  it('stops before the next call when shouldStop flips (budget / kill switch)', async () => {
    const { client, search } = fakeClient({
      q1: [{ url: DEV, title: 'A', description: 'aaa' }],
      q2: [{ url: ATS, title: 'B', description: 'bbb' }],
    });

    const out = await runCandidateSearch({
      client,
      queries: ['q1', 'q2'],
      shouldStop: () => search.mock.calls.length >= 1,
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(out.queriesRun).toBe(1);
    expect(out.raw).toHaveLength(1);
  });

  it('reports per-call credits through onCall', async () => {
    const { client } = fakeClient({ q1: [{ url: DEV, title: 'A', description: 'aaa' }] });
    const calls: string[] = [];
    await runCandidateSearch({
      client,
      queries: ['q1'],
      scrapeDetails: true,
      onCall: (kind) => calls.push(kind),
    });
    expect(calls).toEqual(['search', 'scrape']);
  });
});
