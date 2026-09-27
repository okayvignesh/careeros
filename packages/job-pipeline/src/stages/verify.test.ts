import { describe, expect, it } from 'vitest';
import { verify } from './verify';
import { normalize } from './normalize';
import { greenhouseRaw, makeRawJob, remotiveRaw } from '../../__fixtures__/raw-jobs';

const TRUSTED = ['greenhouse', 'ashby'] as const;

describe('verify (B-10)', () => {
  it('clean row from a trusted source → trusted, no reasons', () => {
    const r = verify(normalize(greenhouseRaw), { trustedSources: TRUSTED });
    // MUTATION SMOKE: flip default verdict to 'flagged' and this fails.
    expect(r.verdict).toBe('trusted');
    expect(r.reasons).toEqual([]);
  });

  it('clean row from an unlisted source → flagged with `unverified-source`', () => {
    // remotive is NOT in TRUSTED
    const r = verify(normalize(remotiveRaw), { trustedSources: TRUSTED });
    // MUTATION SMOKE: default all sources trusted → verdict flips to 'trusted'
    // and this test fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('unverified-source');
  });

  it('empty title → flagged with `blank-title`', () => {
    const n = normalize(makeRawJob({ title: 'x' })); // pass Zod min(1)
    n.title = '   '; // simulate a post-normalize whitespace-only bug
    const r = verify(n, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: skip the trim → `'   '.length === 0` is false, verdict
    // becomes 'trusted' and this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('blank-title');
  });

  it('empty company → flagged with `blank-company`', () => {
    const n = normalize(remotiveRaw);
    n.company = '';
    const r = verify(n, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: check `title` twice instead of `company` and this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('blank-company');
  });

  it('non-http URL → flagged with `non-http-url`', () => {
    const n = normalize(remotiveRaw);
    n.canonicalUrl = 'javascript:alert(1)';
    const r = verify(n, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: only reject on `URL` throw → `javascript:` parses fine
    // and slips through; this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toContain('non-http-url');
  });

  it('accepts http and https', () => {
    const n1 = normalize(remotiveRaw);
    n1.canonicalUrl = 'http://acme.example/jobs/1';
    const r1 = verify(n1, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: only allow https → this fails.
    expect(r1.reasons).not.toContain('non-http-url');

    const n2 = normalize(remotiveRaw);
    n2.canonicalUrl = 'https://acme.example/jobs/1';
    const r2 = verify(n2, { trustedSources: ['remotive'] });
    expect(r2.reasons).not.toContain('non-http-url');
  });

  it('thin description (< minDescriptionChars) → flagged with `thin-description`', () => {
    const n = normalize(remotiveRaw);
    n.description = 'hire me'; // 7 chars, well under default 40
    const r = verify(n, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: compare with `>` instead of `<` → 7 > 40 false, no
    // reason emitted, this fails.
    expect(r.reasons).toContain('thin-description');
  });

  it('honors custom minDescriptionChars', () => {
    const n = normalize(remotiveRaw);
    n.description = 'x'.repeat(20);
    const flagged = verify(n, { trustedSources: ['remotive'], minDescriptionChars: 40 });
    // MUTATION SMOKE: hardcode 40 and ignore opts → the `100` case below still
    // passes (bigger threshold catches 20), but flip to `minDescriptionChars: 5`
    // and this fails because 20 > 5 should NOT flag.
    expect(flagged.reasons).toContain('thin-description');
    const clean = verify(n, { trustedSources: ['remotive'], minDescriptionChars: 5 });
    expect(clean.reasons).not.toContain('thin-description');
  });

  it('multiple hard-fail reasons accumulate; verdict stays `flagged`', () => {
    const n = normalize(remotiveRaw);
    n.title = '';
    n.company = '';
    n.description = 'x';
    n.canonicalUrl = 'ftp://nope';
    const r = verify(n, { trustedSources: ['remotive'] });
    // MUTATION SMOKE: return on first reason (early break) → reasons length
    // drops to 1 and this fails.
    expect(r.verdict).toBe('flagged');
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        'blank-title',
        'blank-company',
        'non-http-url',
        'thin-description',
      ]),
    );
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('trustedSources default is empty → every source flagged as `unverified-source`', () => {
    const r = verify(normalize(greenhouseRaw));
    // MUTATION SMOKE: default trustedSources to `['greenhouse']` and this fails.
    expect(r.reasons).toContain('unverified-source');
    expect(r.verdict).toBe('flagged');
  });
});
