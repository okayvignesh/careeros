import { describe, expect, it } from 'vitest';
import { crossSourceDedupe, levenshtein } from './cross-source-dedupe';
import { normalize } from './normalize';
import { makeRawJob } from '../../__fixtures__/raw-jobs';

const DESC =
  'We are hiring a senior backend engineer to build our distributed platform. Experience with Node.js and PostgreSQL required.';

function j(overrides: {
  source?: string;
  sourceId?: string;
  company?: string;
  title?: string;
  desc?: string;
  url?: string;
}) {
  return normalize(
    makeRawJob({
      sourceName: overrides.source ?? 'remotive',
      sourceId: overrides.sourceId ?? Math.random().toString(36).slice(2, 10),
      company: overrides.company ?? 'Acme Inc',
      title: overrides.title ?? 'Senior Backend Engineer',
      description: overrides.desc ?? DESC,
      canonicalUrl: overrides.url ?? `https://example.com/${Math.random().toString(36).slice(2, 10)}`,
    }),
  );
}

describe('crossSourceDedupe (C-P3.2c)', () => {
  it('empty input → empty output', () => {
    const r = crossSourceDedupe([]);
    // MUTATION SMOKE: return [undefined] → this fails.
    expect(r.unique).toEqual([]);
    expect(r.duplicates).toEqual([]);
    expect(r.mergedSourceTagsByWinner.size).toBe(0);
  });

  it('one job → one unique, no duplicates', () => {
    const only = j({ source: 'remotive' });
    const r = crossSourceDedupe([only]);
    // MUTATION SMOKE: mark every row as duplicate → this fails.
    expect(r.unique).toEqual([only]);
    expect(r.duplicates).toEqual([]);
    expect(r.mergedSourceTagsByWinner.get(only)).toEqual([only.sourceTag]);
  });

  it('two different jobs at the same company → both survive', () => {
    const a = j({ company: 'Acme Inc', title: 'Senior Backend Engineer' });
    const b = j({
      company: 'Acme Inc',
      title: 'Staff Frontend Engineer',
      desc: 'Frontend role owning our design system, React + TypeScript required.',
    });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: dedupe on company alone → drops one, this fails.
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('exact-dup (same company + same title + same desc) across sources → merged', () => {
    const ashby = j({ source: 'ashby', sourceId: 'a1', url: 'https://a.example/1' });
    const remotive = j({ source: 'remotive', sourceId: 'r1', url: 'https://r.example/1' });
    const r = crossSourceDedupe([remotive, ashby]);
    // MUTATION SMOKE: never merge → length becomes 2, this fails.
    expect(r.unique).toHaveLength(1);
    // Winner is ashby (tier 1 beats tier 2), even though remotive came first.
    expect(r.unique[0]!.primarySource).toBe('ashby');
    expect(r.mergedSourceTagsByWinner.get(r.unique[0]!)).toEqual(
      expect.arrayContaining(['ashby:a1', 'remotive:r1']),
    );
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.winner).toBe(ashby);
    expect(r.duplicates[0]!.loser).toBe(remotive);
  });

  it('near-dup company ("Acme, Inc." vs "acme inc") → merged (Levenshtein ≤ 2)', () => {
    const a = j({ source: 'ashby', company: 'Acme, Inc.' });
    const b = j({ source: 'remotive', company: 'acme inc' });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: skip company normalization → distance blows past 2, this fails.
    expect(r.unique).toHaveLength(1);
  });

  it('different companies ("Acme" vs "Beta") → NOT merged', () => {
    const a = j({ source: 'ashby', company: 'Acme Inc' });
    const b = j({ source: 'remotive', company: 'Beta Corp' });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: match on title alone → merges, this fails.
    expect(r.unique).toHaveLength(2);
  });

  it('title overlap ≥ 0.75 with parenthetical suffix → merged', () => {
    const a = j({
      source: 'ashby',
      title: 'Senior Backend Engineer',
    });
    const b = j({
      source: 'remotive',
      title: 'Senior Backend Engineer (Remote)', // 3/4 tokens overlap
    });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: require exact title match → drops merge, this fails.
    expect(r.unique).toHaveLength(1);
    expect(r.unique[0]!.primarySource).toBe('ashby');
  });

  it('title overlap < 0.75 → NOT merged even when company + desc match', () => {
    const a = j({ title: 'Senior Backend Engineer' });
    const b = j({ title: 'Junior Marketing Coordinator' });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: threshold at 0 → any pair merges, this fails.
    expect(r.unique).toHaveLength(2);
  });

  it('different first-200-char desc → NOT merged even when company + title match', () => {
    const a = j({ desc: 'a'.repeat(300) });
    const b = j({ desc: 'b'.repeat(300) });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: skip desc-hash check → merges, this fails.
    expect(r.unique).toHaveLength(2);
  });

  it('description hash uses collapsed whitespace prefix (extra whitespace tolerated)', () => {
    const clean = DESC;
    const wsMess = DESC.replace(/ /g, '\n\n\n');
    const a = j({ source: 'ashby', desc: clean });
    const b = j({ source: 'remotive', desc: wsMess });
    const r = crossSourceDedupe([a, b]);
    // MUTATION SMOKE: hash raw prefix → whitespace mismatch, no merge, this fails.
    expect(r.unique).toHaveLength(1);
  });

  it('higher-tier wins the merge; sourceIds accumulate on winner', () => {
    // Insertion order: aggregator first, ATS second. Winner must still be ATS.
    const agg = j({ source: 'remotive', sourceId: 'rid' });
    const ats = j({ source: 'greenhouse', sourceId: 'gid' });
    const r = crossSourceDedupe([agg, ats]);
    // MUTATION SMOKE: first-seen wins regardless of tier → remotive wins, this fails.
    expect(r.unique[0]!.primarySource).toBe('greenhouse');
    expect(r.mergedSourceTagsByWinner.get(r.unique[0]!)).toEqual(
      expect.arrayContaining(['greenhouse:gid', 'remotive:rid']),
    );
  });

  it('equal-tier merge: first-seen wins (stable)', () => {
    const a = j({ source: 'adzuna', sourceId: 'a' });
    const b = j({ source: 'remotive', sourceId: 'b' });
    const r = crossSourceDedupe([a, b]);
    // Both tier 2. MUTATION SMOKE: last-seen wins → primarySource flips, this fails.
    expect(r.unique[0]!.primarySource).toBe('adzuna');
    expect(r.mergedSourceTagsByWinner.get(r.unique[0]!)).toEqual(['adzuna:a', 'remotive:b']);
  });

  it('three-way merge: keeps only the top-tier winner', () => {
    const ashby = j({ source: 'ashby', sourceId: 'A' });
    const adzuna = j({ source: 'adzuna', sourceId: 'B' });
    const remotive = j({ source: 'remotive', sourceId: 'C' });
    const r = crossSourceDedupe([adzuna, remotive, ashby]);
    // MUTATION SMOKE: only merge pairs (skip transitive) → length > 1, this fails.
    expect(r.unique).toHaveLength(1);
    expect(r.unique[0]!.primarySource).toBe('ashby');
    expect(r.mergedSourceTagsByWinner.get(r.unique[0]!)!.sort()).toEqual(
      ['adzuna:B', 'ashby:A', 'remotive:C'].sort(),
    );
    // 2 losers → 2 duplicate pairs (adzuna vs remotive first pair-match may merge
    // adzuna into remotive equal-tier winner, then that winner merges into ashby).
    expect(r.duplicates.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves input order for unmerged jobs', () => {
    const a = j({ source: 'ashby', company: 'Alpha Co', title: 'Backend Dev', url: 'https://x/a', desc: 'first job description content here plenty of chars to fill the prefix window nicely' });
    const b = j({ source: 'ashby', company: 'Beta Co', title: 'Frontend Dev', url: 'https://x/b', desc: 'second job different content here plenty of chars to fill the prefix window separately' });
    const c = j({ source: 'ashby', company: 'Gamma Co', title: 'Data Sci', url: 'https://x/c', desc: 'third job unrelated payload also plenty of chars to fill the description prefix hash' });
    const r = crossSourceDedupe([c, a, b]);
    // MUTATION SMOKE: sort by company → order becomes [a,b,c], this fails.
    expect(r.unique.map((k) => k.company)).toEqual(['Gamma Co', 'Alpha Co', 'Beta Co']);
  });

  it('does not mutate input jobs', () => {
    const a = j({ source: 'ashby' });
    const b = j({ source: 'remotive' });
    const snapshot = JSON.stringify([a, b]);
    crossSourceDedupe([a, b]);
    // MUTATION SMOKE: winner.sourceIds.push(...) on the job object itself → snapshot diverges, this fails.
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });

  it('levenshtein: basic cases (self=0, insertion, substitution)', () => {
    // MUTATION SMOKE: swap + and - in the recurrence → these values drift, this fails.
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('acme', 'acmee')).toBe(1);
    expect(levenshtein('Acme', 'acme')).toBe(1); // case-sensitive at the char level
  });
});
