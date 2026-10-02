import { describe, expect, it } from 'vitest';
import type { RawJob } from '../types';
import { planIngest } from './ingest-plan';

function raw(over: Partial<RawJob>): RawJob {
  const now = Date.now();
  return {
    sourceId: 's1',
    sourceName: 'firecrawl',
    canonicalUrl: 'https://jobs.lever.co/acme/1',
    title: 'Senior Backend Engineer',
    company: 'Acme',
    location: null,
    remote: true,
    description: 'A long enough description to pass the thin-description verify rule with room to spare.',
    sourcePostedAt: new Date(now - 86_400_000),
    fetchedAt: new Date(now),
    payload: {},
    ...over,
  };
}

describe('planIngest (normalize → dedupe → verify)', () => {
  it('keeps survivors and logs rejected rows with a reason', () => {
    const raws: RawJob[] = [
      raw({ sourceId: 'ok', canonicalUrl: 'https://jobs.lever.co/acme/ok' }),
      raw({
        sourceId: 'stale',
        canonicalUrl: 'https://jobs.lever.co/acme/stale',
        title: 'Stale Role',
        company: 'StaleCo',
        sourcePostedAt: new Date(Date.now() - 200 * 86_400_000),
      }),
    ];
    const plan = planIngest(raws);
    expect(plan.normalized).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]!.reason).toBeTruthy();
    expect(plan.rejected[0]!.sourceId).toBe('stale');
    expect(plan.rejected[0]!.details.canonicalUrl).toContain('/stale');
  });

  it('folds cross-source duplicates and carries merged source tags', () => {
    const raws: RawJob[] = [
      raw({ sourceId: 'a1', sourceName: 'ashby', canonicalUrl: 'https://jobs.ashbyhq.com/acme/1' }),
      raw({
        sourceId: 'f1',
        sourceName: 'firecrawl',
        canonicalUrl: 'https://jobs.lever.co/acme/1',
      }),
    ];
    const plan = planIngest(raws);
    expect(plan.normalized).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
    const tags = plan.mergedSourceTagsByWinner.get(plan.normalized[0]!) ?? [];
    expect(tags).toHaveLength(2);
  });
});
