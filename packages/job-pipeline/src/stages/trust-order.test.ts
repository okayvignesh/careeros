import { describe, expect, it } from 'vitest';
import { tierFor, trustOrder, TIER_BY_ADAPTER } from './trust-order';
import { normalize } from './normalize';
import type { NormalizedJob } from './normalize';
import { greenhouseRaw, makeRawJob, REF_NOW } from '../../__fixtures__/raw-jobs';

const NOW_MS = REF_NOW.getTime();
const DAY_MS = 86_400_000;
const daysAgo = (d: number): Date => new Date(NOW_MS - d * DAY_MS);

function j(overrides: {
  source?: string;
  postedAt?: Date | null;
  title?: string;
  desc?: string;
  url?: string;
}): NormalizedJob {
  return normalize(
    makeRawJob({
      sourceName: overrides.source ?? 'remotive',
      sourceId: `id-${Math.random().toString(36).slice(2, 8)}`,
      sourcePostedAt: overrides.postedAt === undefined ? new Date(NOW_MS) : overrides.postedAt,
      title: overrides.title ?? 'Senior Backend Engineer',
      description:
        overrides.desc ??
        'We are hiring a senior backend engineer for the platform team. Long enough to pass verify.',
      canonicalUrl: overrides.url ?? `https://ex.com/${Math.random().toString(36).slice(2, 8)}`,
    }),
  );
}

describe('trustOrder (C-P3.2b)', () => {
  it('empty input → empty output', () => {
    // MUTATION SMOKE: return [undefined] → this fails.
    expect(trustOrder([])).toEqual([]);
  });

  it('single job → single job back (no sort, no filter)', () => {
    const one = j({ source: 'ashby' });
    // MUTATION SMOKE: return [] → this fails.
    expect(trustOrder([one])).toEqual([one]);
  });

  it('tier map: ATS < aggregator < unknown', () => {
    // MUTATION SMOKE: swap ashby to tier 2 → this fails.
    expect(TIER_BY_ADAPTER.ashby).toBe(1);
    expect(TIER_BY_ADAPTER.greenhouse).toBe(1);
    // Keyless first-party ATS postings APIs.
    expect(TIER_BY_ADAPTER.lever).toBe(1);
    expect(TIER_BY_ADAPTER.smartrecruiters).toBe(1);
    expect(TIER_BY_ADAPTER.workable).toBe(1);
    expect(TIER_BY_ADAPTER.adzuna).toBe(2);
    expect(TIER_BY_ADAPTER.arbeitnow).toBe(2);
    expect(TIER_BY_ADAPTER.remotive).toBe(2);
    // Tenant/partner-gated career-site APIs stay tier 2 until verified.
    expect(TIER_BY_ADAPTER.icims).toBe(2);
    expect(TIER_BY_ADAPTER.successfactors).toBe(2);
    // MUTATION SMOKE: default unknown to tier 1 → this fails.
    expect(tierFor('agent-scraped')).toBe(3);
    expect(tierFor('greenhouse')).toBe(1);
  });

  it('ATS (tier 1) sorts above aggregator (tier 2)', () => {
    const ats = j({ source: 'greenhouse', postedAt: daysAgo(30) });
    const agg = j({ source: 'remotive', postedAt: new Date(NOW_MS) });
    const out = trustOrder([agg, ats]);
    // MUTATION SMOKE: sort by tier DESC → agg wins, this fails.
    expect(out[0]!.primarySource).toBe('greenhouse');
    expect(out[1]!.primarySource).toBe('remotive');
  });

  it('aggregator (tier 2) sorts above unknown (tier 3)', () => {
    const agg = j({ source: 'adzuna' });
    const unknown = j({ source: 'some-random-agent' });
    const out = trustOrder([unknown, agg]);
    // MUTATION SMOKE: unknown defaults to tier 2 → tie-break by freshness, order flips, this fails.
    expect(out[0]!.primarySource).toBe('adzuna');
    expect(out[1]!.primarySource).toBe('some-random-agent');
  });

  it('same tier: trusted verdict wins over flagged', () => {
    // Both tier 2; agg1 has blank company (flagged), agg2 clean (trusted).
    const flagged = { ...j({ source: 'remotive' }), company: '' };
    const trusted = j({ source: 'remotive' });
    const out = trustOrder([flagged, trusted]);
    // MUTATION SMOKE: swap verdict rank → flagged sorts above trusted, this fails.
    expect(out[0]).toBe(trusted);
    expect(out[1]).toBe(flagged);
  });

  it('rejected verdict is filtered out (not returned in output)', () => {
    const reject = { ...j({ source: 'remotive' }), title: '' }; // blank-title = reject
    const keep = j({ source: 'remotive' });
    const out = trustOrder([reject, keep]);
    // MUTATION SMOKE: keep rejected rows → length becomes 2, this fails.
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(keep);
  });

  it('same tier + same verdict: newer sourcePostedAt wins', () => {
    const newer = j({ source: 'remotive', postedAt: new Date(NOW_MS) });
    const older = j({ source: 'remotive', postedAt: daysAgo(30) });
    const out = trustOrder([older, newer]);
    // MUTATION SMOKE: sort freshness ASC (a-b) → older wins, this fails.
    expect(out[0]).toBe(newer);
    expect(out[1]).toBe(older);
  });

  it('null sourcePostedAt sinks to the bottom of the tie-break', () => {
    const dated = j({ source: 'remotive', postedAt: daysAgo(60) });
    const nullDate = j({ source: 'remotive', postedAt: null });
    const out = trustOrder([nullDate, dated]);
    // MUTATION SMOKE: default null date to `now` → nullDate wins, this fails.
    expect(out[0]).toBe(dated);
    expect(out[1]).toBe(nullDate);
  });

  it('sort is stable when every key is equal', () => {
    // Two rows, identical everything except URL (used to identify each). Same
    // tier, same verdict (both trusted from a clean adapter), same postedAt.
    const a = j({ source: 'remotive', postedAt: new Date(NOW_MS), url: 'https://ex.com/a' });
    const b = j({ source: 'remotive', postedAt: new Date(NOW_MS), url: 'https://ex.com/b' });
    const out = trustOrder([a, b]);
    // MUTATION SMOKE: reverse the output → order flips, this fails.
    expect(out[0]!.canonicalUrl).toBe('https://ex.com/a');
    expect(out[1]!.canonicalUrl).toBe('https://ex.com/b');
  });

  it('full ladder: mixed pool sorts into expected order', () => {
    const atsOld = j({ source: 'greenhouse', postedAt: daysAgo(40) });
    const atsNew = j({ source: 'ashby', postedAt: daysAgo(1) });
    const agg = j({ source: 'remotive', postedAt: new Date(NOW_MS) });
    const unknown = j({ source: 'agent-x' });
    const reject = { ...normalize(greenhouseRaw), title: '' };
    const out = trustOrder([agg, reject, unknown, atsOld, atsNew]);
    // Expected: [atsNew, atsOld, agg, unknown]; reject filtered.
    // MUTATION SMOKE: skip the tier layer → agg + unknown mix up top, this fails.
    expect(out.map((k) => k.primarySource)).toEqual(['ashby', 'greenhouse', 'remotive', 'agent-x']);
  });

  it('tierOverrides remaps a source without shipping a code change', () => {
    const custom = j({ source: 'custom-ats' });
    const rem = j({ source: 'remotive' });
    // Without override: custom-ats is tier 3, sorts below remotive (tier 2).
    const defaultOrder = trustOrder([custom, rem]);
    expect(defaultOrder[0]!.primarySource).toBe('remotive');
    // With override: custom-ats becomes tier 1, sorts above remotive.
    const overridden = trustOrder([custom, rem], { tierOverrides: { 'custom-ats': 1 } });
    // MUTATION SMOKE: ignore tierOverrides → same order as default, this fails.
    expect(overridden[0]!.primarySource).toBe('custom-ats');
  });

  it('does not mutate the input array', () => {
    const a = j({ source: 'remotive' });
    const b = j({ source: 'ashby' });
    const input = [a, b];
    trustOrder(input);
    // MUTATION SMOKE: sort-in-place `input.sort(...)` → order flips, this fails.
    expect(input).toEqual([a, b]);
  });
});
