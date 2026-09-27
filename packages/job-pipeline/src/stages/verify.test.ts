import { describe, expect, it } from 'vitest';
import { verify } from './verify';
import { normalize } from './normalize';
import type { NormalizedJob } from './normalize';
import { greenhouseRaw, makeRawJob, REF_NOW, remotiveRaw } from '../../__fixtures__/raw-jobs';

const NOW_MS = REF_NOW.getTime();
const DAY_MS = 86_400_000;
const daysAgo = (d: number): Date => new Date(NOW_MS - d * DAY_MS);

/**
 * Build a NormalizedJob with a compBandUsd — the normalize path needs an
 * adapter-supplied salaryText, which the default fixtures don't carry. This
 * helper mutates the shape after the fact so absurd-salary tests can inject
 * bands without threading salary text through every adapter fixture.
 */
function withComp(job: NormalizedJob, min: number, max: number): NormalizedJob {
  return {
    ...job,
    compBandUsd: { min, max, currency: 'USD', period: 'year' },
  };
}

describe('verify (C-P3.2a) — verdict ladder', () => {
  it('clean row → trusted, no reasons', () => {
    // remotiveRaw is fresh (2026-09-20, 7 days before REF_NOW), full desc, valid URL.
    const r = verify(normalize(remotiveRaw), { now: NOW_MS });
    // MUTATION SMOKE: flip verdict default to 'flagged' → this fails.
    expect(r.verdict).toBe('trusted');
    expect(r.reasons).toEqual([]);
  });

  it('any reject-severity hit → verdict `rejected` even alongside flags', () => {
    const j = { ...normalize(remotiveRaw), title: '' }; // blank-title = reject
    j.company = ''; // blank-company = flag
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: return 'flagged' whenever any hit fires → 'rejected' expectation fails.
    expect(r.verdict).toBe('rejected');
    expect(r.reasons).toEqual(expect.arrayContaining(['blank-title', 'blank-company']));
  });

  it('only flag-severity hits → verdict `flagged`', () => {
    const j = { ...normalize(remotiveRaw), company: '' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: promote blank-company to reject → verdict becomes 'rejected' and this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toEqual(['blank-company']);
  });
});

describe('verify (C-P3.2a) — individual rules', () => {
  it('blank title → rejected `blank-title`', () => {
    const j = { ...normalize(remotiveRaw), title: '   ' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: skip .trim() → whitespace-only title passes and this fails.
    expect(r.verdict).toBe('rejected');
    expect(r.reasons).toContain('blank-title');
  });

  it('blank company → flagged `blank-company`', () => {
    const j = { ...normalize(remotiveRaw), company: '' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: check title twice → 'blank-company' never emitted, this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('blank-company');
  });

  it('thin description (< 50 chars) → flagged `thin-description`', () => {
    const j = { ...normalize(remotiveRaw), description: 'Hire me plz' }; // 11 chars
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: compare with `>` instead of `<` → 11 > 50 false, this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('thin-description');
  });

  it('description exactly at minDescriptionChars is NOT thin (strict <)', () => {
    const j = { ...normalize(remotiveRaw), description: 'x'.repeat(50) };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: flip to `<=` → 50 <= 50 true, 'thin-description' emitted, this fails.
    expect(r.reasons).not.toContain('thin-description');
  });

  it('honors custom minDescriptionChars', () => {
    const j = { ...normalize(remotiveRaw), description: 'x'.repeat(20) };
    // 20 chars, threshold 40 → thin. Same 20 chars, threshold 5 → not thin.
    // MUTATION SMOKE: hardcode 50 and ignore opts → the 5-threshold assertion below fails.
    expect(verify(j, { now: NOW_MS, minDescriptionChars: 40 }).reasons).toContain(
      'thin-description',
    );
    expect(verify(j, { now: NOW_MS, minDescriptionChars: 5 }).reasons).not.toContain(
      'thin-description',
    );
  });

  it('absurd low salary ($5/hr equiv) → flagged `absurd-salary`', () => {
    const j = withComp(normalize(remotiveRaw), 5000, 8000); // way below $20.8k floor
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: only check the upper bound → low salary slips through, this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('absurd-salary');
  });

  it('absurd high salary (> $1M) → flagged `absurd-salary`', () => {
    const j = withComp(normalize(remotiveRaw), 500_000, 5_000_000);
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: only check the lower bound → high salary passes, this fails.
    expect(r.reasons).toContain('absurd-salary');
  });

  it('reasonable salary ($100k–$200k) → no absurd-salary reason', () => {
    const j = withComp(normalize(remotiveRaw), 100_000, 200_000);
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: swap comparison operators → real salaries flagged, this fails.
    expect(r.reasons).not.toContain('absurd-salary');
  });

  it('no comp data → no absurd-salary reason (missing = no signal)', () => {
    const j = normalize(remotiveRaw); // no salaryText → compBandUsd is null
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: default null-band to `{min:0,max:0}` → 0 < floor triggers, this fails.
    expect(r.reasons).not.toContain('absurd-salary');
  });

  it('posting > 90 days old → rejected `stale`', () => {
    const j = { ...normalize(remotiveRaw), sourcePostedAt: daysAgo(120) };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: invert the age comparison → old post treated as fresh, this fails.
    expect(r.verdict).toBe('rejected');
    expect(r.reasons).toContain('stale');
  });

  it('posting = 90 days old exactly is NOT stale (strict >)', () => {
    const j = { ...normalize(remotiveRaw), sourcePostedAt: daysAgo(90) };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: flip to `>=` → boundary rejects, this fails.
    expect(r.reasons).not.toContain('stale');
  });

  it('posting with null sourcePostedAt → no stale reason (freshness owns null)', () => {
    const j = { ...normalize(remotiveRaw), sourcePostedAt: null };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: default null date to epoch 0 → 56 years ago, reject fires, this fails.
    expect(r.reasons).not.toContain('stale');
  });

  it('honors custom maxAgeDays', () => {
    const j = { ...normalize(remotiveRaw), sourcePostedAt: daysAgo(45) };
    // 45d old, ceiling 30 → stale. Ceiling 90 (default) → not stale.
    // MUTATION SMOKE: ignore opts.maxAgeDays → 30-day threshold still passes, this fails.
    expect(verify(j, { now: NOW_MS, maxAgeDays: 30 }).reasons).toContain('stale');
    expect(verify(j, { now: NOW_MS, maxAgeDays: 90 }).reasons).not.toContain('stale');
  });

  it('blocklist token in description → rejected `blocklist:<token>`', () => {
    const j = {
      ...normalize(remotiveRaw),
      description: `${remotiveRaw.description}\n\nEarn crypto from home, guaranteed income daily!`,
    };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: match on exact string only (not substring) → this fails
    // because the token is embedded in a longer sentence.
    expect(r.verdict).toBe('rejected');
    expect(r.reasons).toEqual(
      expect.arrayContaining(['blocklist:earn crypto', 'blocklist:guaranteed income']),
    );
  });

  it('blocklist matching is case-insensitive', () => {
    const j = { ...normalize(remotiveRaw), description: 'Learn about PYRAMID schemes here.' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: drop the .toLowerCase() on the haystack → capital PYRAMID misses, this fails.
    expect(r.reasons).toContain('blocklist:pyramid');
  });

  it('custom rejectBlocklist extends the default list', () => {
    const j = { ...normalize(remotiveRaw), description: 'Ping us on Signal for shady_ops offers.' };
    const r = verify(j, { now: NOW_MS, rejectBlocklist: ['shady_ops'] });
    // MUTATION SMOKE: only use defaults (ignore opts.rejectBlocklist) → this fails.
    expect(r.reasons).toContain('blocklist:shady_ops');
  });

  it('all-caps title (SR ENGINEER (REMOTE)) → flagged `all-caps-title`', () => {
    const j = { ...normalize(remotiveRaw), title: 'SENIOR ENGINEER REMOTE POSITION' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: threshold at 100% instead of 80% → tokens-with-mixed-case titles pass, this fails.
    expect(r.reasons).toContain('all-caps-title');
  });

  it('mixed-case title (Senior Engineer) → no all-caps reason', () => {
    const r = verify(normalize(remotiveRaw), { now: NOW_MS });
    // MUTATION SMOKE: check for any capital letter → real titles flagged, this fails.
    expect(r.reasons).not.toContain('all-caps-title');
  });

  it('short title with acronyms (AI/ML Lead) → not all-caps (tokens < 3)', () => {
    const j = { ...normalize(remotiveRaw), title: 'AI Lead' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: drop the tokens.length<3 guard → short titles trigger, this fails.
    expect(r.reasons).not.toContain('all-caps-title');
  });

  it('bot-whitespace description (many \\n\\n\\n\\n runs) → flagged `bot-whitespace`', () => {
    const j = {
      ...normalize(remotiveRaw),
      description: `About us:${'\n'.repeat(6)}Role:${'\n'.repeat(8)}Reqs:${'\n'.repeat(5)}Apply now`,
    };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: match only tabs (not newlines) → these runs miss, this fails.
    expect(r.reasons).toContain('bot-whitespace');
  });

  it('human-formatted paragraph breaks → no bot-whitespace reason', () => {
    const j = {
      ...normalize(remotiveRaw),
      description: 'Para one.\n\nPara two.\n\nPara three.',
    };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: match \s{2,} instead of \s{4,} → normal `\n\n` triggers, this fails.
    expect(r.reasons).not.toContain('bot-whitespace');
  });

  it('non-http URL → flagged `non-http-url`', () => {
    const j = { ...normalize(remotiveRaw), canonicalUrl: 'javascript:alert(1)' };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: only reject on URL parse throw → 'javascript:' parses, slips through, this fails.
    expect(r.reasons).toContain('non-http-url');
  });

  it('unverified-source rule fires only when trustedSources is non-empty', () => {
    const j = normalize(remotiveRaw); // primarySource='remotive'
    // Default opts (no trustedSources) → rule is a no-op.
    const noOpts = verify(j, { now: NOW_MS });
    expect(noOpts.reasons).not.toContain('unverified-source');
    // With trustedSources set that excludes 'remotive' → flagged.
    const withTrusted = verify(j, { now: NOW_MS, trustedSources: ['ashby', 'greenhouse'] });
    // MUTATION SMOKE: default `trusted = new Set(['greenhouse'])` → withTrusted still contains
    // 'unverified-source' but noOpts also does; noOpts assertion fails.
    expect(withTrusted.reasons).toContain('unverified-source');
  });

  it('source in trustedSources set → no unverified-source reason', () => {
    const j = normalize(greenhouseRaw); // primarySource='greenhouse'
    const r = verify(j, { now: NOW_MS, trustedSources: ['ashby', 'greenhouse'] });
    // MUTATION SMOKE: `!trusted.has(...)` → `trusted.has(...)` inverts logic, this fails.
    expect(r.reasons).not.toContain('unverified-source');
  });
});

describe('verify (C-P3.2a) — reason accumulation', () => {
  it('multiple failures all appear in reasons (no early return)', () => {
    const j = {
      ...normalize(remotiveRaw),
      title: '',
      company: '',
      description: 'x',
      canonicalUrl: 'ftp://nope',
      sourcePostedAt: daysAgo(200),
    };
    const r = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: return on first hit → reasons length drops to 1, this fails.
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        'blank-title',
        'blank-company',
        'thin-description',
        'non-http-url',
        'stale',
      ]),
    );
    expect(r.reasons.length).toBeGreaterThanOrEqual(5);
    // highest severity wins.
    expect(r.verdict).toBe('rejected');
  });

  it('reasons are stable in order across calls (deterministic)', () => {
    const j = { ...normalize(remotiveRaw), company: '', description: 'x' };
    const r1 = verify(j, { now: NOW_MS });
    const r2 = verify(j, { now: NOW_MS });
    // MUTATION SMOKE: iterate a Set instead of an array → order becomes non-deterministic, this fails.
    expect(r1.reasons).toEqual(r2.reasons);
  });
});

describe('verify (C-P3.2a) — hardening', () => {
  it('does not mutate the input job', () => {
    const j = normalize(remotiveRaw);
    const snapshot = JSON.stringify(j);
    verify(j, { now: NOW_MS, trustedSources: ['greenhouse'] });
    // MUTATION SMOKE: annotate `j.verdict = ...` inside verify → snapshot mismatch, this fails.
    expect(JSON.stringify(j)).toBe(snapshot);
  });

  it('empty opts object works without throwing', () => {
    // MUTATION SMOKE: destructure opts without default → undefined access throws, this fails.
    expect(() => verify(normalize(remotiveRaw), {})).not.toThrow();
  });
});
