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

describe('relevance — P1 soft signals never hide a job', () => {
  it('emits workplace_mismatch only when remoteOnly is off', () => {
    const on = relevance(
      job({ workplaceType: 'onsite' }),
      prefs({ workplaceTypes: ['remote'] }),
      { now: NOW },
    );
    expect(on.relevant).toBe(true);
    expect(on.signals?.map((s) => s.type)).toEqual(['workplace_mismatch']);

    // remoteOnly=true reconciles: the hard filter owns the axis, no signal.
    const reconciled = relevance(
      job({ remote: true, workplaceType: 'hybrid' }),
      prefs({ remoteOnly: true, workplaceTypes: ['onsite'] }),
      { now: NOW },
    );
    expect(reconciled).toEqual({ relevant: true });
  });

  it('emits location_mismatch for an off-target country', () => {
    const out = relevance(
      job({ country: 'US' }),
      prefs({ countries: ['DE', 'NL'] }),
      { now: NOW },
    );
    expect(out.relevant).toBe(true);
    expect(out.signals?.map((s) => s.type)).toContain('location_mismatch');
  });

  it('emits relocation_required for an onsite foreign role when not willing to relocate', () => {
    const out = relevance(
      job({ remote: false, workplaceType: 'onsite', country: 'DE' }),
      prefs({ homeCountry: 'IN', relocationWilling: false }),
      { now: NOW },
    );
    expect(out.signals?.map((s) => s.type)).toContain('relocation_required');
  });

  it('emits authorization_required + sponsorship_unclear for a foreign role with no signal', () => {
    const out = relevance(
      job({ country: 'US', sponsorshipSignal: 'unclear' }),
      prefs({ homeCountry: 'IN' }),
      { now: NOW },
    );
    const types = out.signals?.map((s) => s.type) ?? [];
    expect(types).toContain('authorization_required');
    expect(types).toContain('sponsorship_unclear');
  });

  it('emits comp_uncomparable across currencies', () => {
    const out = relevance(
      job({ compCurrency: 'EUR' }),
      prefs({ currency: 'USD' }),
      { now: NOW },
    );
    expect(out.signals?.map((s) => s.type)).toEqual(['comp_uncomparable']);
  });

  it('omits signals entirely when nothing applies', () => {
    const out = relevance(job(), prefs(), { now: NOW });
    expect(JSON.stringify(out)).toBe('{"relevant":true}');
  });
});
