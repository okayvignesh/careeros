import { describe, expect, it } from 'vitest';
import { dedupe } from './dedupe';
import { normalize } from './normalize';
import { greenhouseRaw, makeRawJob, remotiveRaw } from '../../__fixtures__/raw-jobs';

describe('dedupe (B-10)', () => {
  it('empty input → empty unique + empty duplicates', () => {
    const r = dedupe([]);
    // MUTATION SMOKE: return `{ unique: [{}], duplicates: [] }` and this fails.
    expect(r.unique).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it('two rows with distinct canonicalUrls both survive', () => {
    const a = normalize(remotiveRaw);
    const b = normalize(greenhouseRaw);
    const r = dedupe([a, b]);
    // MUTATION SMOKE: dedupe by title or company instead of canonicalUrl and
    // this fails because both fixtures have distinct URLs.
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('first occurrence wins; subsequent same-URL rows go to duplicates', () => {
    const first = normalize(makeRawJob({ sourceId: '1', title: 'First seen' }));
    const dup = normalize(makeRawJob({ sourceId: '2', title: 'Second seen' }));
    // Both fixtures share `remotiveRaw.canonicalUrl` by default.
    const r = dedupe([first, dup]);
    // MUTATION SMOKE: last-wins (`seen.delete(...)`) flips these two and fails.
    expect(r.unique).toHaveLength(1);
    expect(r.unique[0]!.title).toBe('First seen');
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.title).toBe('Second seen');
  });

  it('preserves input order in `unique`', () => {
    const a = normalize(makeRawJob({ canonicalUrl: 'https://x.example/a' }));
    const b = normalize(makeRawJob({ canonicalUrl: 'https://x.example/b' }));
    const c = normalize(makeRawJob({ canonicalUrl: 'https://x.example/c' }));
    const r = dedupe([b, a, c]);
    // MUTATION SMOKE: sort by URL and the order becomes [a,b,c] — this fails.
    expect(r.unique.map((n) => n.canonicalUrl)).toEqual([
      'https://x.example/b',
      'https://x.example/a',
      'https://x.example/c',
    ]);
  });

  it('three occurrences of one URL → 1 unique + 2 duplicates', () => {
    const one = normalize(makeRawJob({ sourceId: 'a' }));
    const two = normalize(makeRawJob({ sourceId: 'b' }));
    const three = normalize(makeRawJob({ sourceId: 'c' }));
    const r = dedupe([one, two, three]);
    // MUTATION SMOKE: use a Set for output (loses count) → duplicates length
    // drops to 0 or 1 and this fails.
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates).toHaveLength(2);
    expect(r.duplicates.map((n) => n.sourceTag)).toEqual(['remotive:b', 'remotive:c']);
  });

  it('does not mutate the input array', () => {
    const a = normalize(remotiveRaw);
    const b = normalize(makeRawJob({ sourceId: 'dup' })); // same URL as a
    const input = [a, b];
    dedupe(input);
    // MUTATION SMOKE: `normalized.splice(...)` in-place mutation fails this.
    expect(input).toHaveLength(2);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});
