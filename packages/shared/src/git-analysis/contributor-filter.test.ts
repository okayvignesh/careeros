import { describe, it, expect } from 'vitest';
import {
  filterOwnCommits,
  normalizeEmail,
  buildKnownEmailSet,
  type CommitLike,
} from './contributor-filter';

describe('normalizeEmail', () => {
  it('trims + lowercases', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });
  it('folds GitHub noreply id+login', () => {
    expect(normalizeEmail('12345+alice@users.noreply.github.com')).toBe(
      'alice@users.noreply.github.com',
    );
  });
  it('leaves plain noreply alone', () => {
    expect(normalizeEmail('alice@users.noreply.github.com')).toBe(
      'alice@users.noreply.github.com',
    );
  });
  it('empty/null yields empty', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

describe('buildKnownEmailSet', () => {
  it('adds a noreply for the github login', () => {
    const set = buildKnownEmailSet({ emails: ['a@b.com'], githubLogin: 'Alice' });
    expect(set.has('a@b.com')).toBe(true);
    expect(set.has('alice@users.noreply.github.com')).toBe(true);
  });
  it('deduplicates on normalize', () => {
    const set = buildKnownEmailSet({
      emails: ['12345+alice@users.noreply.github.com', 'alice@users.noreply.github.com'],
    });
    expect(set.size).toBe(1);
  });
});

describe('filterOwnCommits', () => {
  const commits: CommitLike[] = [
    { sha: 'a', authorEmail: 'me@example.com', committerEmail: 'me@example.com' },
    { sha: 'b', authorEmail: 'other@example.com', committerEmail: 'other@example.com' },
    { sha: 'c', authorEmail: '12345+me@users.noreply.github.com', committerEmail: null },
    { sha: 'd', authorEmail: null, committerEmail: 'me@Example.com' }, // case + committer path
    { sha: 'e', authorEmail: 'stranger@example.com', committerEmail: 'me@example.com' }, // web-merge
  ];

  it('keeps only commits whose author or committer email matches', () => {
    const out = filterOwnCommits(commits, {
      emails: ['me@example.com'],
      githubLogin: 'me',
    });
    expect(out.map((c) => c.sha).sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('returns empty when no known emails are supplied', () => {
    expect(filterOwnCommits(commits, { emails: [] })).toEqual([]);
  });

  it('does not credit merged upstream commits from unknown authors', () => {
    const out = filterOwnCommits(
      [{ sha: 'z', authorEmail: 'ext@upstream.example', committerEmail: 'ext@upstream.example' }],
      { emails: ['me@example.com'] },
    );
    expect(out).toEqual([]);
  });
});
