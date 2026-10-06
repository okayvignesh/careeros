import { describe, expect, it } from 'vitest';
import { relevance, type RelevancePrefs } from './relevance';
import { computeMatch, computeMatchResult } from './match';

/**
 * Frozen backward-compatibility contract (job-targeting §11).
 *
 * A legacy caller that supplies no geo/comp input must get byte-identical
 * `relevance`/`match` output. These snapshots are intentionally literal: if a
 * P1 addition leaks a new field (`signals`, `geoFit`, `compFit`) into the
 * legacy path, this test fails.
 */
const NOW = new Date('2026-06-01T00:00:00.000Z');

const LEGACY_PREFS: RelevancePrefs = {
  remoteOnly: false,
  mustHaveSkills: [],
  dealbreakerSkills: [],
  companyBlacklist: [],
};

describe('frozen legacy snapshot', () => {
  it('relevance legacy relevant → exactly { relevant: true }', () => {
    const out = relevance(
      {
        company: 'Acme',
        remote: true,
        skillIds: ['ts'],
        sourcePostedAt: NOW,
        firstSeenAt: NOW,
      },
      LEGACY_PREFS,
      { now: NOW },
    );
    expect(JSON.stringify(out)).toBe('{"relevant":true}');
  });

  it('relevance legacy reject → exactly { relevant, reason }', () => {
    const out = relevance(
      {
        company: 'Acme',
        remote: false,
        skillIds: ['ts'],
        sourcePostedAt: NOW,
        firstSeenAt: NOW,
      },
      { ...LEGACY_PREFS, remoteOnly: true },
      { now: NOW },
    );
    expect(JSON.stringify(out)).toBe('{"relevant":false,"reason":"remote-only"}');
  });

  it('computeMatchResult legacy → no geoFit/compFit keys', () => {
    const out = computeMatchResult({
      jobId: 'job-1',
      required: [
        { skillId: 'ts', weight: 1 },
        { skillId: 'react', weight: 1 },
      ],
      nameById: new Map(),
      stateBySkill: new Map([
        ['ts', { proficiency: 80, recencyDays: 5 }],
        ['react', { proficiency: 40, recencyDays: 5 }],
      ]),
      evidenceBySkill: new Map(),
    });
    expect(JSON.stringify(out)).toBe(
      '{"score":0.6000000000000001,"matched":1,"total":2,"missing":["react"]}',
    );
  });

  it('computeMatch legacy → no geoFit/compFit keys', () => {
    const out = computeMatch({
      jobId: 'job-1',
      required: [{ skillId: 'ts', weight: 1 }],
      nameById: new Map(),
      stateBySkill: new Map([['ts', { proficiency: 100, recencyDays: 1 }]]),
      evidenceBySkill: new Map(),
      now: NOW,
    });
    expect('geoFit' in out).toBe(false);
    expect('compFit' in out).toBe(false);
    expect(JSON.stringify(out)).toBe(
      '{"jobId":"job-1","score":1,"readiness":1,"gap":[],"explanations":[{"kind":"strong","skillId":"ts","skillName":"ts","note":"Strong: proficiency 1.00, 0 recent evidence row(s)."}],"computedAt":"2026-06-01T00:00:00.000Z"}',
    );
  });
});
