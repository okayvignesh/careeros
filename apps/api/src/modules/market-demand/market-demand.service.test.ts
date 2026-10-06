import { describe, expect, it } from 'vitest';
import {
  computeSkillDemand,
  computeTrendSignals,
  MarketDemandService,
  type DemandJob,
  type SkillMeta,
} from './market-demand.service';

// Pure projection tests: no Prisma, no clock drift (NOW is passed in). The
// service wrapper is exercised only for the empty-pool contract.

const NOW = new Date('2026-10-02T12:00:00Z');
const DAY = 86_400_000;

function job(partial: Partial<DemandJob> & { skillIds: string[]; daysAgo: number }): DemandJob {
  const { daysAgo, ...rest } = partial;
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    skillIds: rest.skillIds,
    company: rest.company ?? 'Acme',
    remote: rest.remote ?? true,
    primarySource: rest.primarySource ?? 'remotive',
    sourcePostedAt: rest.sourcePostedAt === undefined ? at : rest.sourcePostedAt,
    firstSeenAt: rest.firstSeenAt ?? at,
    country: rest.country !== undefined ? rest.country : null,
    region: rest.region !== undefined ? rest.region : null,
    workplaceType: rest.workplaceType !== undefined ? rest.workplaceType : null,
    remoteScope: rest.remoteScope !== undefined ? rest.remoteScope : null,
  };
}

function skill(id: string, name: string, category: string): SkillMeta {
  return { id, name, category, cluster: null };
}

describe('computeSkillDemand', () => {
  const jobs: DemandJob[] = [
    job({ skillIds: ['ts', 'postgres'], daysAgo: 1 }),
    job({ skillIds: ['ts', 'k8s'], daysAgo: 3 }),
    job({ skillIds: ['postgres'], daysAgo: 10 }),
    job({ skillIds: ['python'], daysAgo: 20 }),
  ];
  const skills = new Map([
    ['ts', skill('ts', 'TypeScript', 'frontend')],
    ['postgres', skill('postgres', 'PostgreSQL', 'data')],
    ['k8s', skill('k8s', 'Kubernetes', 'cloud')],
    ['python', skill('python', 'Python', 'language')],
  ]);

  it('counts postings/share and sorts by postings desc', () => {
    const rows = computeSkillDemand(jobs, skills, new Map(), 30, NOW);
    expect(rows.map((r) => r.skillId)).toEqual(['ts', 'postgres', 'k8s', 'python']);
    const ts = rows[0]!;
    expect(ts.postings).toBe(2);
    expect(ts.share).toBeCloseTo(2 / 4);
    expect(ts.label).toBe('TypeScript');
    expect(ts.cluster).toBe('frontend');
  });

  it('emits a 7-bucket history that sums to the posting count', () => {
    const rows = computeSkillDemand(jobs, skills, new Map(), 30, NOW);
    const postgres = rows.find((r) => r.skillId === 'postgres')!;
    expect(postgres.history).toHaveLength(7);
    expect(postgres.history.reduce((a, b) => a + b, 0)).toBe(postgres.postings);
  });

  it('gap is demand score minus demonstrated level, floored at 0', () => {
    // ts share = 0.5 -> demand score 50. level 20 -> gap 30.
    const rows = computeSkillDemand(jobs, skills, new Map([['ts', 20]]), 30, NOW);
    expect(rows.find((r) => r.skillId === 'ts')!.gap).toBe(30);
    // level above demand -> floored at 0.
    const covered = computeSkillDemand(jobs, skills, new Map([['ts', 90]]), 30, NOW);
    expect(covered.find((r) => r.skillId === 'ts')!.gap).toBe(0);
  });

  it('falls back to the raw id + uncategorized when the catalogue misses a skill', () => {
    const rows = computeSkillDemand(
      [job({ skillIds: ['mystery'], daysAgo: 1 })],
      new Map(),
      new Map(),
      30,
      NOW,
    );
    expect(rows[0]!.label).toBe('mystery');
    expect(rows[0]!.cluster).toBe('uncategorized');
  });

  it('returns [] for an empty pool', () => {
    expect(computeSkillDemand([], skills, new Map(), 30, NOW)).toEqual([]);
  });
});

describe('computeTrendSignals', () => {
  it('classifies rising / steady / declining against the prior-60d baseline', () => {
    const jobs: DemandJob[] = [
      // rising: 6 recent, 0 prior.
      ...Array.from({ length: 6 }, () => job({ skillIds: ['rising'], daysAgo: 5 })),
      // steady: 3 recent, 6 prior -> baseline 3, ratio 1.0.
      ...Array.from({ length: 3 }, () => job({ skillIds: ['steady'], daysAgo: 5 })),
      ...Array.from({ length: 6 }, () => job({ skillIds: ['steady'], daysAgo: 50 })),
      // declining: 1 recent, 8 prior -> baseline 4, ratio 0.25.
      ...Array.from({ length: 1 }, () => job({ skillIds: ['falling'], daysAgo: 5 })),
      ...Array.from({ length: 8 }, () => job({ skillIds: ['falling'], daysAgo: 50 })),
    ];
    const skills = new Map([
      ['rising', skill('rising', 'Rising', 'cloud')],
      ['steady', skill('steady', 'Steady', 'data')],
      ['falling', skill('falling', 'Falling', 'practice')],
    ]);
    const out = computeTrendSignals(jobs, skills, NOW);
    const by = new Map(out.map((r) => [r.id, r]));
    expect(by.get('rising')!.trajectory).toBe('rising');
    expect(by.get('steady')!.trajectory).toBe('steady');
    expect(by.get('falling')!.trajectory).toBe('declining');
    expect(by.get('rising')!.mentions).toBe(6);
    expect(by.get('rising')!.history.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('counts distinct sources and earliest firstSeen', () => {
    const jobs: DemandJob[] = [
      job({ skillIds: ['ts'], daysAgo: 40, primarySource: 'remotive' }),
      job({ skillIds: ['ts'], daysAgo: 2, primarySource: 'firecrawl' }),
      job({ skillIds: ['ts'], daysAgo: 1, primarySource: 'remotive' }),
    ];
    const out = computeTrendSignals(
      jobs,
      new Map([['ts', skill('ts', 'TypeScript', 'frontend')]]),
      NOW,
    );
    expect(out[0]!.sources).toBe(2);
    expect(out[0]!.firstSeen).toBe(new Date(NOW.getTime() - 40 * DAY).toISOString().slice(0, 10));
  });

  it('returns [] for an empty pool', () => {
    expect(computeTrendSignals([], new Map(), NOW)).toEqual([]);
  });
});

function service(jobs: DemandJob[], prefsOverride: Record<string, unknown> = {}) {
  const prisma = { normalizedJob: { findMany: async () => jobs } };
  const prefs = {
    get: async () => ({
      targetRoles: [],
      locations: [],
      remoteOnly: false,
      currency: 'USD',
      seniority: [],
      mustHaveSkills: [],
      dealbreakerSkills: [],
      companyBlacklist: [],
      countries: [],
      workplaceTypes: [],
      remoteScopes: [],
      updatedAt: null,
      ...prefsOverride,
    }),
  };
  return new MarketDemandService(prisma as never, prefs as never);
}

describe('MarketDemandService empty-pool contract', () => {
  it('returns an empty rows array (not an error) when the pool is empty', async () => {
    await expect(service([]).skillDemand('user-1', 30)).resolves.toEqual({
      windowDays: 30,
      rows: [],
    });
  });

  it('returns an empty signals array when the pool is empty', async () => {
    const out = await service([]).trendSignals('user-1');
    expect(out.signals).toEqual([]);
    expect(typeof out.generatedAt).toBe('string');
  });
});

describe('MarketDemandService geo-scoped pool (P2 §8)', () => {
  const corpus: DemandJob[] = [
    job({ skillIds: ['ts', 'postgres'], daysAgo: 1, country: 'US', region: 'north_america' }),
    job({ skillIds: ['java'], daysAgo: 2, country: 'DE', region: 'europe' }),
    // Null geo row: excluded when a country axis is constrained.
    job({ skillIds: ['php'], daysAgo: 3, country: null, region: null }),
  ];

  it('demandBySkill counts only jobs in the target country', async () => {
    const demand = await service(corpus, { countries: ['DE'] }).demandBySkill('u1', 30);
    expect([...demand.keys()]).toEqual(['java']);
  });

  it('null geo is excluded when a country axis is constrained (with a reason)', async () => {
    const demand = await service(corpus, { countries: ['DE'] }).demandBySkill('u1', 30);
    expect(demand.has('php')).toBe(false);
  });

  it('counts null-geo jobs when NO country axis is constrained', async () => {
    const demand = await service(corpus, {}).demandBySkill('u1', 30);
    expect([...demand.keys()].sort()).toEqual(['java', 'php', 'postgres', 'ts']);
  });

  it('scopes by region when the country is unknown but the region is targeted', async () => {
    const rows: DemandJob[] = [
      job({ skillIds: ['rust'], daysAgo: 1, country: null, region: 'europe' }),
      job({ skillIds: ['go'], daysAgo: 1, country: null, region: 'north_america' }),
    ];
    const demand = await service(rows, { countries: ['DE'] }).demandBySkill('u1', 30);
    expect([...demand.keys()]).toEqual(['rust']);
  });

  it('is a behavior change: the old learning-priority pool applied no prefs/geo filter', async () => {
    // Blacklist still applies (loadPool always did), but geo now does too.
    const demand = await service(corpus, {
      countries: ['US'],
      companyBlacklist: ['Acme'],
    }).demandBySkill('u1', 30);
    expect(demand.size).toBe(0);
  });
});
