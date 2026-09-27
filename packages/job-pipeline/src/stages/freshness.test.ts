import { describe, expect, it } from 'vitest';
import { freshness } from './freshness';
import { REF_NOW } from '../../__fixtures__/raw-jobs';

const DAY_MS = 86_400_000;
const nowMs = REF_NOW.getTime();
const daysAgo = (d: number): Date => new Date(nowMs - d * DAY_MS);

describe('freshness (B-10)', () => {
  it('posting from today is fresh (no aging reason)', () => {
    const r = freshness({ sourcePostedAt: REF_NOW }, { maxAgeDays: 45, now: nowMs });
    // MUTATION SMOKE: swap `<` to `<=` in the stale check with same-instant
    // posted → still passes; but flip the fresh return to `false` and this fails.
    expect(r.fresh).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('posting older than maxAgeDays is stale', () => {
    const r = freshness({ sourcePostedAt: daysAgo(60) }, { maxAgeDays: 45, now: nowMs });
    // MUTATION SMOKE: invert the comparison in the stale branch → fresh:true
    // and this fails.
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe('stale');
  });

  it('posting exactly at maxAgeDays boundary is still fresh (strict `<` matches pre-refactor `postedMs < staleCutoff`)', () => {
    // Old service: `if (postedMs < staleCutoff)` — exactly at the cutoff is NOT
    // stale. Change to `<=` in the extracted freshness and this test fails.
    const r = freshness({ sourcePostedAt: daysAgo(45) }, { maxAgeDays: 45, now: nowMs });
    expect(r.fresh).toBe(true);
  });

  it('aging warning when older than agingDays but younger than maxAgeDays', () => {
    const r = freshness(
      { sourcePostedAt: daysAgo(20) },
      { maxAgeDays: 45, agingDays: 14, now: nowMs },
    );
    // MUTATION SMOKE: drop the agingDays branch → reason is undefined and this fails.
    expect(r.fresh).toBe(true);
    expect(r.reason).toBe('aging');
  });

  it('exactly at agingDays boundary is NOT aging (strict `>` matches pre-refactor `nowMs - postedMs > AGING_DAYS * DAY_MS`)', () => {
    const r = freshness(
      { sourcePostedAt: daysAgo(14) },
      { maxAgeDays: 45, agingDays: 14, now: nowMs },
    );
    // MUTATION SMOKE: change `>` to `>=` in the aging check and this test fails.
    expect(r.reason).toBeUndefined();
  });

  it('no agingDays option → never emits `aging` reason even when older than 14d', () => {
    const r = freshness({ sourcePostedAt: daysAgo(30) }, { maxAgeDays: 45, now: nowMs });
    // MUTATION SMOKE: default agingDays to 14 in-function and this fails.
    expect(r.fresh).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('falls back to firstSeenAt when sourcePostedAt is null (matches `r.sourcePostedAt ?? r.firstSeenAt`)', () => {
    const r = freshness(
      { sourcePostedAt: null, firstSeenAt: daysAgo(60) },
      { maxAgeDays: 45, now: nowMs },
    );
    // MUTATION SMOKE: drop the firstSeenAt fallback → uses `now` and returns
    // fresh:true, this fails.
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe('stale');
  });

  it('null sourcePostedAt AND no firstSeenAt → treated as posted-now (fresh)', () => {
    const r = freshness({ sourcePostedAt: null }, { maxAgeDays: 45, now: nowMs });
    // MUTATION SMOKE: throw on both null → this fails. Pre-refactor service
    // never allowed both null (DB column has @default(now())), so `fresh` is
    // the safe default the service would have produced.
    expect(r.fresh).toBe(true);
  });

  it('accepts Date as `now` option (not just number)', () => {
    const r = freshness({ sourcePostedAt: daysAgo(60) }, { maxAgeDays: 45, now: REF_NOW });
    // MUTATION SMOKE: only accept `number` for `now` and this test errors.
    expect(r.fresh).toBe(false);
  });

  it('ageMs is nowMs - postedMs', () => {
    const r = freshness({ sourcePostedAt: daysAgo(10) }, { maxAgeDays: 45, now: nowMs });
    // MUTATION SMOKE: report ageMs as postedMs (or 0) → this fails.
    expect(r.ageMs).toBe(10 * DAY_MS);
  });
});
