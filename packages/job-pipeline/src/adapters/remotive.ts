import type { JobSourceAdapter, RawJob } from '../types';

/**
 * Remotive public jobs API. https://remotive.com/api/remote-jobs — free,
 * unauthenticated, returns up to ~1000 remote roles. Tier-2 aggregator per
 * the blueprint's trust order.
 *
 * ponytail: the walking-skeleton fetches the whole feed each sync. Adzuna-style
 * `since` cursoring lands when the second adapter arrives — Remotive itself
 * doesn't offer an incremental endpoint, so operators either dedupe on
 * canonicalUrl (current) or read `publication_date` and skip old rows client-side.
 */

const REMOTIVE_URL = 'https://remotive.com/api/remote-jobs';

export interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location: string;
  publication_date: string;
  description: string;
  job_type?: string;
  salary?: string;
  category?: string;
}

interface RemotiveFeed {
  jobs?: RemotiveJob[];
}

export const remotiveAdapter: JobSourceAdapter = {
  id: 'remotive',
  name: 'Remotive',
  tier: 2,
  licenseHint: 'Public JSON feed; per-listing rights owned by originating employer.',
  attribution: 'Sourced via Remotive (remotive.com). Listings © their respective employers.',
  async fetch(): Promise<RawJob[]> {
    const res = await globalThis.fetch(REMOTIVE_URL, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`remotive fetch failed: ${res.status}`);
    const data = (await res.json()) as RemotiveFeed;
    return (data.jobs ?? []).map(mapRemotive);
  },
};

/** Exported for tests — same input the adapter feeds after fetching. */
export function mapRemotive(j: RemotiveJob): RawJob {
  const posted = new Date(j.publication_date);
  return {
    sourceId: String(j.id),
    sourceName: 'remotive',
    canonicalUrl: j.url,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || null,
    remote: true, // Remotive is remote-only by definition
    description: j.description,
    sourcePostedAt: Number.isNaN(posted.getTime()) ? null : posted,
    fetchedAt: new Date(),
    payload: j,
  };
}
