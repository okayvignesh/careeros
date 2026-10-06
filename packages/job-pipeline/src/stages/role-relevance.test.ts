import { describe, it, expect } from 'vitest';
import { titleMatchesRoles, roleTokens } from './role-relevance';

describe('titleMatchesRoles', () => {
  it('keeps roles that share a meaningful token (incl. substring/synonym)', () => {
    expect(titleMatchesRoles('Senior Backend Engineer - Ledger Platform', ['Backend Engineer'])).toBe(true);
    expect(titleMatchesRoles('Engineering Lead', ['Backend Engineer'])).toBe(true);
    expect(titleMatchesRoles('Site Reliability Engineer', ['SRE'])).toBe(true);
  });

  it('drops clearly unrelated functions', () => {
    const roles = ['Backend Engineer', 'Platform Engineer'];
    expect(titleMatchesRoles('Enterprise Account Manager - UKI', roles)).toBe(false);
    expect(titleMatchesRoles('Senior Growth Marketer', roles)).toBe(false);
    expect(titleMatchesRoles('Financial Analyst', roles)).toBe(false);
  });

  it('is a no-op with no target roles', () => {
    expect(titleMatchesRoles('Anything', [])).toBe(true);
  });

  it('roleTokens ignores seniority words and expands synonyms', () => {
    const t = roleTokens(['Senior Backend Engineer']);
    expect(t.has('senior')).toBe(false);
    expect(t.has('backend')).toBe(true);
    expect(t.has('server')).toBe(true);
    expect(t.has('engineer')).toBe(true);
  });
});
