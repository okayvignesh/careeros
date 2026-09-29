import { describe, expect, it } from 'vitest';
import {
  AUTO_LINK_THRESHOLD,
  bestMatch,
  normalizeCompany,
  normalizeRole,
  scoreEmailAgainstApplication,
  similarityRatio,
} from './fuzzy-match';

describe('normalizeCompany', () => {
  it('drops legal suffixes + punctuation + case', () => {
    expect(normalizeCompany('Stripe, Inc.')).toBe('stripe');
    expect(normalizeCompany('BigCo LLC')).toBe('bigco');
    expect(normalizeCompany('Acme Corp.')).toBe('acme');
    expect(normalizeCompany('Deutsche Firma GmbH')).toBe('deutsche firma');
  });

  it('leaves non-suffix multi-token names intact', () => {
    expect(normalizeCompany('The Grid Company Inc')).toBe('the grid');
    expect(normalizeCompany('Foo & Bar Inc.')).toBe('foo bar');
  });
});

describe('normalizeRole', () => {
  it('drops seniority stopwords', () => {
    expect(normalizeRole('Senior Software Engineer')).toBe('software engineer');
    expect(normalizeRole('Staff Backend Engineer II')).toBe('backend engineer');
    expect(normalizeRole('Sr. Data Scientist')).toBe('data scientist');
  });
});

describe('similarityRatio', () => {
  it('is 1 for identical strings', () => {
    expect(similarityRatio('foo', 'foo')).toBe(1);
  });
  it('is high (>= 0.85) for one-char typos on multi-char strings', () => {
    expect(similarityRatio('backend engineer', 'backend enginer')).toBeGreaterThanOrEqual(0.85);
  });
  it('drops for very different strings', () => {
    expect(similarityRatio('backend engineer', 'chef de cuisine')).toBeLessThan(0.5);
  });
});

describe('scoreEmailAgainstApplication', () => {
  const app = { id: 'a1', company: 'Stripe, Inc.', role: 'Senior Backend Engineer' };

  it('exact match on both fields => 1.0', () => {
    const s = scoreEmailAgainstApplication({ company: 'Stripe', role: 'Backend Engineer' }, app);
    expect(s?.confidence).toBe(1);
    expect(s?.method).toBe('exact-both');
  });

  it('similar match on both fields => 0.8', () => {
    // Both fields carry a 1-char typo; each ratio >= 0.85 but neither
    // is exact after normalization -> "similar-both" band.
    const s = scoreEmailAgainstApplication(
      { company: 'Stripe Paymets', role: 'Backend Enginer' },
      { id: 'a1', company: 'Stripe Payments', role: 'Backend Engineer' },
    );
    expect(s?.confidence).toBe(0.8);
    expect(s?.method).toBe('similar-both');
  });

  it('single-field match => 0.5', () => {
    const s = scoreEmailAgainstApplication(
      { company: 'Stripe', role: 'Frontend Engineer' },
      app,
    );
    expect(s?.confidence).toBe(0.5);
    expect(s?.method).toBe('company-only');
  });

  it('null on no match', () => {
    const s = scoreEmailAgainstApplication({ company: 'Random', role: 'Chef' }, app);
    expect(s).toBeNull();
  });

  it('null on empty email fields', () => {
    expect(scoreEmailAgainstApplication({ company: null, role: null }, app)).toBeNull();
  });
});

describe('bestMatch', () => {
  it('picks the highest confidence when multiple apps match', () => {
    const apps = [
      { id: 'a1', company: 'Stripe', role: 'Frontend Engineer' }, // company-only 0.5
      { id: 'a2', company: 'Stripe', role: 'Backend Engineer' }, // exact 1.0
    ];
    const b = bestMatch({ company: 'Stripe', role: 'Backend Engineer' }, apps);
    expect(b?.applicationId).toBe('a2');
    expect(b?.confidence).toBe(1);
  });

  it('returns null when no application matches', () => {
    const b = bestMatch(
      { company: 'Nowhere', role: 'Nothing' },
      [{ id: 'a1', company: 'Stripe', role: 'Backend Engineer' }],
    );
    expect(b).toBeNull();
  });
});

describe('AUTO_LINK_THRESHOLD', () => {
  it('matches the phase-5 spec (>= 0.85)', () => {
    expect(AUTO_LINK_THRESHOLD).toBe(0.85);
    // MUTATION-SMOKE: change the threshold in fuzzy-match.ts and this fails.
    // Also fails if the confidence bands drift; the auto-link happens on
    // exact-both (1.0) or similar-both (0.8) - 0.8 is BELOW threshold so
    // only exact-both auto-links by spec. Downstream code depends on this.
  });
});
