import { describe, expect, it } from 'vitest';
import { normalize } from './normalize';
import { greenhouseRaw, makeRawJob, remotiveRaw } from '../../__fixtures__/raw-jobs';

describe('normalize (B-10)', () => {
  it('copies every persisted field verbatim from raw', () => {
    const n = normalize(remotiveRaw);
    // MUTATION SMOKE: drop any of these copies (e.g. hardcode `title: ""`)
    // and this test fails on the mismatched field.
    expect(n.canonicalUrl).toBe(remotiveRaw.canonicalUrl);
    expect(n.title).toBe(remotiveRaw.title);
    expect(n.company).toBe(remotiveRaw.company);
    expect(n.location).toBe(remotiveRaw.location);
    expect(n.remote).toBe(remotiveRaw.remote);
    expect(n.description).toBe(remotiveRaw.description);
    expect(n.sourcePostedAt).toEqual(remotiveRaw.sourcePostedAt);
  });

  it('primarySource is the adapter sourceName', () => {
    // MUTATION SMOKE: swap primarySource to sourceId or a literal and this
    // fails — the old service used `r.sourceName` for `primarySource`.
    expect(normalize(remotiveRaw).primarySource).toBe('remotive');
    expect(normalize(greenhouseRaw).primarySource).toBe('greenhouse');
  });

  it('sourceTag is `${sourceName}:${sourceId}` — matches jobs.service pre-refactor', () => {
    // MUTATION SMOKE: change the join char (`-`, `/`, ` `) or swap order and
    // this fails. The old service concatenated exactly `${r.sourceName}:${r.sourceId}`.
    expect(normalize(remotiveRaw).sourceTag).toBe('remotive:12345');
    expect(normalize(greenhouseRaw).sourceTag).toBe('greenhouse:gh-job-abc-999');
  });

  it('passes null location through unchanged (does not coerce to empty string)', () => {
    const n = normalize(makeRawJob({ location: null }));
    // MUTATION SMOKE: `raw.location ?? ''` would fail this — null must stay null
    // because the Prisma column is nullable and downstream filters distinguish.
    expect(n.location).toBeNull();
  });

  it('passes null sourcePostedAt through unchanged', () => {
    const n = normalize(makeRawJob({ sourcePostedAt: null }));
    // MUTATION SMOKE: `raw.sourcePostedAt ?? new Date()` would flunk this —
    // freshness() falls back to firstSeenAt on null, so silently defaulting to
    // now would inflate a stale posting's apparent freshness.
    expect(n.sourcePostedAt).toBeNull();
  });

  it('is pure — same input, same output; does not mutate raw', () => {
    const frozen = Object.freeze({ ...remotiveRaw });
    const a = normalize(frozen);
    const b = normalize(frozen);
    // MUTATION SMOKE: turn normalize into an object-spread-with-Date.now() and
    // the two calls diverge; freezing the input catches any in-place mutation.
    expect(a).toEqual(b);
  });

  // --- C-P3.3 extensions ---

  it('classifies seniority from title (backward-compat call shape)', () => {
    const n = normalize(remotiveRaw); // "Senior Backend Engineer"
    expect(n.seniority.level).toBe('senior');
    expect(n.seniority.confidence).toBeGreaterThan(0);
  });

  it('classifies role from title + description', () => {
    const n = normalize(remotiveRaw); // "Senior Backend Engineer" + Node.js/PostgreSQL desc
    expect(n.role.family).toBe('backend');
  });

  it('comp fields are null when no salaryText passed (old callers)', () => {
    const n = normalize(remotiveRaw);
    expect(n.compBandOriginal).toBeNull();
    expect(n.compBandUsd).toBeNull();
    expect(n.compCurrency).toBeNull();
  });

  it('parses + FX-converts comp band when salaryText provided (new call shape)', () => {
    const n = normalize({ raw: remotiveRaw, salaryText: '$150k - $200k' });
    expect(n.compBandOriginal).toEqual({ min: 150_000, max: 200_000, currency: 'USD', period: 'year' });
    expect(n.compBandUsd).toEqual({ min: 150_000, max: 200_000, currency: 'USD', period: 'year' });
    expect(n.compCurrency).toBe('USD');
  });

  it('FX-converts EUR comp to USD', () => {
    const n = normalize({ raw: remotiveRaw, salaryText: '€90k-120k' });
    expect(n.compBandOriginal?.currency).toBe('EUR');
    expect(n.compBandUsd?.currency).toBe('USD');
    expect(n.compBandUsd!.min).toBeGreaterThan(90_000); // EUR/USD > 1
  });

  it('unparseable salaryText leaves comp fields null (no fabrication)', () => {
    const n = normalize({ raw: remotiveRaw, salaryText: 'competitive + equity' });
    expect(n.compBandOriginal).toBeNull();
    expect(n.compBandUsd).toBeNull();
    expect(n.compCurrency).toBeNull();
  });
});
