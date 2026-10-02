import { describe, expect, it } from 'vitest';
import { relevance, type RelevancePrefs } from './relevance';

const NOW = new Date('2026-06-01T00:00:00Z');
const DAY = 86_400_000;

function job(overrides: Partial<Parameters<typeof relevance>[0]> = {}) {
  return {
    company: 'Acme',
    remote: true,
    skillIds: ['ts'] as readonly string[],
    sourcePostedAt: NOW,
    firstSeenAt: NOW,
    ...overrides,
  };
}

function prefs(overrides: Partial<RelevancePrefs> = {}): RelevancePrefs {
  return {
    remoteOnly: false,
    mustHaveSkills: [],
    dealbreakerSkills: [],
    companyBlacklist: [],
    ...overrides,
  };
}

describe('relevance — pure filter stage', () => {
  it('fresh, matching, non-restricted job → relevant', () => {
    expect(relevance(job(), prefs(), { now: NOW })).toEqual({ relevant: true });
    // MUTATION SMOKE: flip the final `return { relevant: true }` to false →
    // fails.
  });

  it('stale posting (beyond maxAgeDays) → stale', () => {
    const out = relevance(job({ sourcePostedAt: new Date(NOW.getTime() - 60 * DAY) }), prefs(), {
      maxAgeDays: 45,
      now: NOW,
    });
    expect(out).toEqual({ relevant: false, reason: 'stale' });
    // MUTATION SMOKE: drop the freshness call → row is relevant, fails.
  });

  it('remote-only pref + on-site job → remote-only', () => {
    const out = relevance(job({ remote: false }), prefs({ remoteOnly: true }), { now: NOW });
    expect(out).toEqual({ relevant: false, reason: 'remote-only' });
    // MUTATION SMOKE: swap `prefs.remoteOnly` to `false` → relevant, fails.
  });

  it('company blacklist is case- and whitespace-insensitive → company-blacklisted', () => {
    const out = relevance(job({ company: '  ACME  ' }), prefs({ companyBlacklist: ['acme'] }), {
      now: NOW,
    });
    expect(out).toEqual({ relevant: false, reason: 'company-blacklisted' });
    // MUTATION SMOKE: drop `.toLowerCase().trim()` on either side → no match,
    // relevant, fails.
  });

  it('dealbreaker skill present → has-dealbreaker', () => {
    const out = relevance(job({ skillIds: ['ts', 'php'] }), prefs({ dealbreakerSkills: ['php'] }), {
      now: NOW,
    });
    expect(out).toEqual({ relevant: false, reason: 'has-dealbreaker' });
  });

  it('must-have skill absent → must-have-missing; present → relevant', () => {
    const missing = relevance(job({ skillIds: ['ts'] }), prefs({ mustHaveSkills: ['rust'] }), {
      now: NOW,
    });
    expect(missing).toEqual({ relevant: false, reason: 'must-have-missing' });
    const present = relevance(job({ skillIds: ['ts', 'rust'] }), prefs({ mustHaveSkills: ['rust'] }), {
      now: NOW,
    });
    expect(present).toEqual({ relevant: true });
    // MUTATION SMOKE: invert the must-have check (`jobSkills.has(m)`) →
    // both cases flip and fail.
  });

  it('precedence matches the old inline filter: stale beats remote-only', () => {
    const out = relevance(
      job({ remote: false, sourcePostedAt: new Date(NOW.getTime() - 60 * DAY) }),
      prefs({ remoteOnly: true }),
      { maxAgeDays: 45, now: NOW },
    );
    expect(out).toEqual({ relevant: false, reason: 'stale' });
    // MUTATION SMOKE: reorder the remote check before freshness → reason
    // becomes 'remote-only', fails.
  });
});
