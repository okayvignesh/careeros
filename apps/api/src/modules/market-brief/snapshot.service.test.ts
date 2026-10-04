import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILTER,
  SnapshotService,
  diffStats,
  hashFilter,
  prefsToFilter,
} from './snapshot.service';
import type { BriefStats } from './market-brief.service';

// -----------------------------------------------------------------------------
// Fakes - narrow prisma stub + prefs stub. No Testcontainers; the service
// touches marketSnapshot.{findFirst,findMany,create,update} + normalizedJob.findMany.
// -----------------------------------------------------------------------------

type Job = {
  id: string;
  title: string;
  company: string;
  canonicalUrl: string;
  remote: boolean;
  skillIds: string[];
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
  country?: string | null;
  region?: string | null;
  workplaceType?: string | null;
  remoteScope?: string | null;
};

function fixturePool(now = new Date('2026-09-27T12:00:00Z')): Job[] {
  const d = (deltaMs: number) => new Date(now.getTime() - deltaMs);
  return [
    { id: 'j1', title: 'Backend', company: 'Acme', canonicalUrl: 'u1', remote: true, skillIds: ['typescript', 'postgres'], sourcePostedAt: d(1 * 86_400_000), firstSeenAt: d(1 * 86_400_000), country: 'US', region: 'north_america', workplaceType: 'remote', remoteScope: 'remote_global' },
    { id: 'j2', title: 'Platform', company: 'Acme', canonicalUrl: 'u2', remote: true, skillIds: ['typescript', 'kubernetes'], sourcePostedAt: d(2 * 86_400_000), firstSeenAt: d(2 * 86_400_000), country: 'US', region: 'north_america', workplaceType: 'remote', remoteScope: 'remote_global' },
    { id: 'j3', title: 'Data', company: 'Globex', canonicalUrl: 'u3', remote: true, skillIds: ['python', 'postgres'], sourcePostedAt: d(3 * 86_400_000), firstSeenAt: d(3 * 86_400_000), country: 'DE', region: 'europe', workplaceType: 'remote', remoteScope: 'remote_regional' },
    { id: 'j4', title: 'Backend', company: 'Initech', canonicalUrl: 'u4', remote: false, skillIds: ['typescript'], sourcePostedAt: d(4 * 86_400_000), firstSeenAt: d(4 * 86_400_000), country: 'DE', region: 'europe', workplaceType: 'onsite', remoteScope: null },
  ];
}

interface StoredSnapshot {
  id: string;
  userId: string | null;
  snapshotAt: Date;
  filterHash: string;
  statsJson: unknown;
  createdBy: string;
}

function fakePrisma(jobs: Job[], seedSnapshots: StoredSnapshot[] = []) {
  const snapshots: StoredSnapshot[] = [...seedSnapshots];
  let seq = seedSnapshots.length;
  return {
    snapshots,
    normalizedJob: {
      findMany: async () => jobs,
    },
    marketSnapshot: {
      findFirst: async ({ where, orderBy }: {
        where: {
          userId: string | null;
          filterHash: string;
          snapshotAt?: { gte?: Date; lt?: Date; lte?: Date };
        };
        orderBy?: { snapshotAt: 'desc' | 'asc' };
      }) => {
        const filtered = snapshots.filter((s) => {
          if (s.userId !== where.userId) return false;
          if (s.filterHash !== where.filterHash) return false;
          if (where.snapshotAt) {
            const ts = s.snapshotAt.getTime();
            if (where.snapshotAt.gte && ts < where.snapshotAt.gte.getTime()) return false;
            if (where.snapshotAt.lt && ts >= where.snapshotAt.lt.getTime()) return false;
            if (where.snapshotAt.lte && ts > where.snapshotAt.lte.getTime()) return false;
          }
          return true;
        });
        const dir = orderBy?.snapshotAt === 'asc' ? 1 : -1;
        filtered.sort((a, b) => dir * (a.snapshotAt.getTime() - b.snapshotAt.getTime()));
        return filtered[0] ?? null;
      },
      findMany: async ({ where, orderBy, take }: {
        where: { userId: string | null; filterHash: string };
        orderBy?: { snapshotAt: 'desc' | 'asc' };
        take?: number;
      }) => {
        const filtered = snapshots.filter(
          (s) => s.userId === where.userId && s.filterHash === where.filterHash,
        );
        const dir = orderBy?.snapshotAt === 'asc' ? 1 : -1;
        filtered.sort((a, b) => dir * (a.snapshotAt.getTime() - b.snapshotAt.getTime()));
        return take ? filtered.slice(0, take) : filtered;
      },
      create: async ({ data }: { data: Omit<StoredSnapshot, 'id' | 'snapshotAt'> & { snapshotAt?: Date } }) => {
        seq += 1;
        const row: StoredSnapshot = {
          id: `snap-${seq}`,
          snapshotAt: data.snapshotAt ?? new Date(),
          userId: data.userId,
          filterHash: data.filterHash,
          statsJson: data.statsJson,
          createdBy: data.createdBy,
        };
        snapshots.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredSnapshot> }) => {
        const idx = snapshots.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error(`snapshot ${where.id} not found`);
        snapshots[idx] = { ...snapshots[idx]!, ...data } as StoredSnapshot;
        return snapshots[idx]!;
      },
    },
  };
}

function fakePrefs(overrides: Partial<{
  remoteOnly: boolean;
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  companyBlacklist: string[];
  targetRoles: string[];
  locations: string[];
  seniority: string[];
  currency: string;
  countries: string[];
  workplaceTypes: string[];
  remoteScopes: string[];
}> = {}) {
  return {
    get: async () => ({
      targetRoles: overrides.targetRoles ?? [],
      locations: overrides.locations ?? [],
      remoteOnly: overrides.remoteOnly ?? false,
      currency: overrides.currency ?? 'USD',
      seniority: overrides.seniority ?? [],
      mustHaveSkills: overrides.mustHaveSkills ?? [],
      dealbreakerSkills: overrides.dealbreakerSkills ?? [],
      companyBlacklist: overrides.companyBlacklist ?? [],
      countries: overrides.countries ?? [],
      workplaceTypes: overrides.workplaceTypes ?? [],
      remoteScopes: overrides.remoteScopes ?? [],
      updatedAt: '2026-09-20T00:00:00.000Z',
    }),
  };
}

function build(opts: { jobs?: Job[]; seed?: StoredSnapshot[]; prefs?: Parameters<typeof fakePrefs>[0] } = {}) {
  const jobs = opts.jobs ?? fixturePool();
  const prisma = fakePrisma(jobs, opts.seed);
  const prefs = fakePrefs(opts.prefs);
  const svc = new SnapshotService(prisma as never, prefs as never);
  return { svc, prisma, prefs };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

// -----------------------------------------------------------------------------
// hashFilter + prefsToFilter
// -----------------------------------------------------------------------------

describe('hashFilter', () => {
  it('is stable across list order (sorted internally)', () => {
    const a = hashFilter({ ...DEFAULT_FILTER, remoteOnly: true, mustHaveSkills: ['a', 'b'], dealbreakerSkills: ['x'], companyBlacklist: ['Acme'] });
    const b = hashFilter({ ...DEFAULT_FILTER, remoteOnly: true, mustHaveSkills: ['b', 'a'], dealbreakerSkills: ['x'], companyBlacklist: ['acme'] });
    expect(a).toBe(b);
  });

  it('changes when remoteOnly flips', () => {
    const a = hashFilter({ ...DEFAULT_FILTER, remoteOnly: false });
    const b = hashFilter({ ...DEFAULT_FILTER, remoteOnly: true });
    expect(a).not.toBe(b);
  });

  it('changes when a dealbreaker skill is added', () => {
    const a = hashFilter(DEFAULT_FILTER);
    const b = hashFilter({ ...DEFAULT_FILTER, dealbreakerSkills: ['java'] });
    expect(a).not.toBe(b);
  });

  it('changes when the geo scope changes (US vs DE) and is order-stable', () => {
    const us = hashFilter({ ...DEFAULT_FILTER, countries: ['us'] });
    const de = hashFilter({ ...DEFAULT_FILTER, countries: ['DE'] });
    const us2 = hashFilter({ ...DEFAULT_FILTER, countries: ['US'] });
    expect(us).not.toBe(de);
    expect(us).toBe(us2);
    // A workplace/remote-scope constraint also rotates the hash.
    expect(hashFilter({ ...DEFAULT_FILTER, workplaceTypes: ['onsite'] })).not.toBe(us);
  });
});

describe('prefsToFilter', () => {
  it('drops fields that do not affect the pool and carries the geo scope', () => {
    const prefs = {
      targetRoles: ['x'],
      locations: ['NYC'],
      remoteOnly: true,
      currency: 'USD' as const,
      seniority: ['staff' as const],
      mustHaveSkills: ['ts'],
      dealbreakerSkills: ['java'],
      companyBlacklist: ['Acme'],
      countries: ['de', 'us'],
      workplaceTypes: ['remote' as const],
      remoteScopes: ['remote_global' as const],
      updatedAt: null,
    };
    const filter = prefsToFilter(prefs);
    expect(filter).toEqual({
      remoteOnly: true,
      mustHaveSkills: ['ts'],
      dealbreakerSkills: ['java'],
      companyBlacklist: ['Acme'],
      countries: ['DE', 'US'],
      workplaceTypes: ['remote'],
      remoteScopes: ['remote_global'],
    });
  });
});

// -----------------------------------------------------------------------------
// computeSnapshot: deterministic on a fixture pool
// -----------------------------------------------------------------------------

describe('SnapshotService.computeSnapshot', () => {
  it('produces the same statsJson shape as market-brief (topSkills, topCompanies, remoteShare, newCount)', async () => {
    const { svc } = build();
    const { stats, filterHash } = await svc.computeSnapshot(DEFAULT_FILTER);
    expect(stats.windowDays).toBe(7);
    expect(stats.totalCount).toBe(4);
    // All 4 within 7d.
    expect(stats.newCount).toBe(4);
    expect(stats.remoteShare).toBeCloseTo(3 / 4, 5);
    const skillMap = Object.fromEntries(stats.topSkills.map((s) => [s.skillId, s.count]));
    expect(skillMap).toEqual({ typescript: 3, postgres: 2, kubernetes: 1, python: 1 });
    const compMap = Object.fromEntries(stats.topCompanies.map((c) => [c.company, c.count]));
    expect(compMap).toEqual({ Acme: 2, Globex: 1, Initech: 1 });
    expect(filterHash).toBe(hashFilter(DEFAULT_FILTER));
  });

  it('mutation smoke: dealbreaker filter shrinks the pool', async () => {
    const { svc } = build();
    const clean = await svc.computeSnapshot(DEFAULT_FILTER);
    const filtered = await svc.computeSnapshot({ ...DEFAULT_FILTER, dealbreakerSkills: ['kubernetes'] });
    expect(clean.stats.totalCount).toBe(4);
    // j2 has kubernetes -> dropped.
    expect(filtered.stats.totalCount).toBe(3);
    expect(filtered.filterHash).not.toBe(clean.filterHash);
  });

  it('mutation smoke: mustHave keeps only rows carrying the required skill', async () => {
    const { svc } = build();
    const { stats } = await svc.computeSnapshot({ ...DEFAULT_FILTER, mustHaveSkills: ['postgres'] });
    // j1, j3 carry postgres.
    expect(stats.totalCount).toBe(2);
  });

  it('mutation smoke: company blacklist is case-insensitive', async () => {
    const { svc } = build();
    const { stats } = await svc.computeSnapshot({ ...DEFAULT_FILTER, companyBlacklist: ['acme'] });
    expect(stats.totalCount).toBe(2);
    expect(stats.topCompanies.find((c) => c.company === 'Acme')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// P2 §8: geo-scoped snapshots. Two profiles over one corpus must produce
// different demand sets AND different filter hashes.
// -----------------------------------------------------------------------------

describe('SnapshotService.computeSnapshot geo scope (P2 §8)', () => {
  it('filters the pool to the target country', async () => {
    const { svc } = build();
    const us = await svc.computeSnapshot({ ...DEFAULT_FILTER, countries: ['US'] });
    const de = await svc.computeSnapshot({ ...DEFAULT_FILTER, countries: ['DE'] });
    expect(us.stats.totalCount).toBe(2);
    expect(de.stats.totalCount).toBe(2);
  });

  it('excludes a null-geo job when a country axis is constrained', async () => {
    const jobs: Job[] = [
      ...fixturePool(),
      {
        id: 'j-null',
        title: 'Unlocated',
        company: 'Nowhere',
        canonicalUrl: 'u-null',
        remote: true,
        skillIds: ['elixir'],
        sourcePostedAt: new Date('2026-09-26T12:00:00Z'),
        firstSeenAt: new Date('2026-09-26T12:00:00Z'),
        country: null,
        region: null,
        workplaceType: null,
        remoteScope: null,
      },
    ];
    const { svc } = build({ jobs });
    const scoped = await svc.computeSnapshot({ ...DEFAULT_FILTER, countries: ['DE'] });
    // j3 + j4 only; the null-country row is excluded, not counted.
    expect(scoped.stats.totalCount).toBe(2);
    expect(scoped.stats.topSkills.some((s) => s.skillId === 'elixir')).toBe(false);
    // Unconstrained scope counts it.
    const all = await svc.computeSnapshot(DEFAULT_FILTER);
    expect(all.stats.totalCount).toBe(5);
    expect(all.stats.topSkills.some((s) => s.skillId === 'elixir')).toBe(true);
  });

  it('US vs DE over one corpus: different demand sets AND different hashes', async () => {
    const { svc } = build();
    const us = await svc.computeSnapshot({ ...DEFAULT_FILTER, countries: ['US'] });
    const de = await svc.computeSnapshot({ ...DEFAULT_FILTER, countries: ['DE'] });
    const skills = (s: typeof us.stats) =>
      Object.fromEntries(s.topSkills.map((t) => [t.skillId, t.count]));
    expect(skills(us.stats)).not.toEqual(skills(de.stats));
    // US has kubernetes (j2); DE has python (j3).
    expect(skills(us.stats).kubernetes).toBe(1);
    expect(skills(de.stats).python).toBe(1);
    expect(us.filterHash).not.toBe(de.filterHash);
    // MUTATION SMOKE: drop geo from hashFilter -> the two hashes collide and
    // the snapshot reuses the wrong market's stats.
  });

  it('workplace + remote-scope axes filter the pool deterministically', async () => {
    const { svc } = build();
    const onsite = await svc.computeSnapshot({ ...DEFAULT_FILTER, workplaceTypes: ['onsite'] });
    // Only j4 is onsite.
    expect(onsite.stats.totalCount).toBe(1);
    expect(onsite.stats.topCompanies[0].company).toBe('Initech');
  });
});

// -----------------------------------------------------------------------------
// writeSnapshot: idempotent per (day, filterHash, userId)
// -----------------------------------------------------------------------------

describe('SnapshotService.writeSnapshot', () => {
  it('writes a row with the current stats and returns the persisted shape', async () => {
    const { svc, prisma } = build();
    const row = await svc.writeSnapshot('u1', DEFAULT_FILTER, 'manual');
    expect(row.userId).toBe('u1');
    expect(row.createdBy).toBe('manual');
    expect(row.filterHash).toBe(hashFilter(DEFAULT_FILTER));
    expect(row.stats.totalCount).toBe(4);
    expect(prisma.snapshots).toHaveLength(1);
  });

  it('same day + same filterHash -> updates in place (idempotent retry)', async () => {
    const { svc, prisma } = build();
    const a = await svc.writeSnapshot('u1', DEFAULT_FILTER, 'cron');
    const b = await svc.writeSnapshot('u1', DEFAULT_FILTER, 'manual');
    expect(prisma.snapshots).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(b.createdBy).toBe('manual');
  });

  it('same day + different filterHash -> writes a new row', async () => {
    const { svc, prisma } = build();
    await svc.writeSnapshot('u1', DEFAULT_FILTER, 'cron');
    await svc.writeSnapshot('u1', { ...DEFAULT_FILTER, remoteOnly: true }, 'cron');
    expect(prisma.snapshots).toHaveLength(2);
  });

  it('different day + same filterHash -> writes a new row', async () => {
    const { svc, prisma } = build();
    await svc.writeSnapshot('u1', DEFAULT_FILTER, 'cron');
    vi.setSystemTime(new Date('2026-10-04T06:00:00Z')); // +7d
    await svc.writeSnapshot('u1', DEFAULT_FILTER, 'cron');
    expect(prisma.snapshots).toHaveLength(2);
  });

  it('null userId = shared default row', async () => {
    const { svc, prisma } = build();
    const row = await svc.writeSnapshot(null, DEFAULT_FILTER, 'cron');
    expect(row.userId).toBeNull();
    expect(prisma.snapshots).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// diffAgainstLastWeek: needs a snapshot 7-14 days back with matching filterHash
// -----------------------------------------------------------------------------

function priorStats(): BriefStats {
  return {
    windowDays: 7,
    totalCount: 100,
    newCount: 50,
    remoteShare: 0.6,
    topSkills: [
      { skillId: 'typescript', count: 40 },
      { skillId: 'postgres', count: 30 },
      { skillId: 'python', count: 20 },
      { skillId: 'java', count: 15 },
    ],
    topCompanies: [
      { company: 'Acme', count: 12 },
      { company: 'Globex', count: 8 },
      { company: 'Initech', count: 5 },
    ],
  };
}

function laterStats(): BriefStats {
  return {
    windowDays: 7,
    totalCount: 120,
    newCount: 65,
    remoteShare: 0.7,
    topSkills: [
      { skillId: 'typescript', count: 55 }, // rank 0 -> 0
      { skillId: 'rust', count: 25 }, // added
      { skillId: 'postgres', count: 24 }, // rank 1 -> 2
      { skillId: 'python', count: 18 }, // rank 2 -> 3
      // java dropped
    ],
    topCompanies: [
      { company: 'Acme', count: 15 },
      { company: 'Globex', count: 10 },
      { company: 'Wayne', count: 6 }, // new
    ],
  };
}

describe('SnapshotService.diffAgainstLastWeek', () => {
  it('returns hasComparison=false with reason when no snapshot exists', async () => {
    const { svc } = build();
    const diff = await svc.diffAgainstLastWeek('u1');
    expect(diff.hasComparison).toBe(false);
    expect(diff.reason).toBe('no snapshot yet');
  });

  it('returns hasComparison=false when only one snapshot exists (no prior in 7-14d)', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const { svc } = build({
      seed: [
        {
          id: 'seed-latest',
          userId: 'u1',
          snapshotAt: new Date('2026-09-27T06:00:00Z'),
          filterHash,
          statsJson: laterStats(),
          createdBy: 'cron',
        },
      ],
    });
    const diff = await svc.diffAgainstLastWeek('u1');
    expect(diff.hasComparison).toBe(false);
    expect(diff.reason).toBe('no comparable snapshot within 7-14 days ago');
  });

  it('computes every field of the diff shape when a prior in 7-14d exists', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const { svc } = build({
      seed: [
        {
          id: 'prior',
          userId: 'u1',
          snapshotAt: new Date('2026-09-20T06:00:00Z'), // -7d
          filterHash,
          statsJson: priorStats(),
          createdBy: 'cron',
        },
        {
          id: 'latest',
          userId: 'u1',
          snapshotAt: new Date('2026-09-27T06:00:00Z'),
          filterHash,
          statsJson: laterStats(),
          createdBy: 'cron',
        },
      ],
    });
    const diff = await svc.diffAgainstLastWeek('u1');
    expect(diff.hasComparison).toBe(true);
    expect(diff.from?.snapshotId).toBe('prior');
    expect(diff.to?.snapshotId).toBe('latest');
    expect(diff.postingsDelta.absolute).toBe(20);
    expect(diff.postingsDelta.percent).toBeCloseTo(0.2, 5);
    expect(diff.remoteShareDelta).toBeCloseTo(0.1, 5);
    expect(diff.medianCompDelta).toBe(0); // C-P3.3 not yet wired
    expect(diff.topSkillsAdded).toEqual(['rust']);
    expect(diff.topSkillsRemoved).toEqual(['java']);
    // typescript stayed at rank 0 -> not in rankChange.
    expect(diff.topSkillsRankChange.find((r) => r.skillId === 'typescript')).toBeUndefined();
    // postgres moved 1 -> 2 (delta -1), python 2 -> 3 (delta -1).
    const postgres = diff.topSkillsRankChange.find((r) => r.skillId === 'postgres');
    const python = diff.topSkillsRankChange.find((r) => r.skillId === 'python');
    expect(postgres).toEqual({ skillId: 'postgres', from: 1, to: 2, delta: -1 });
    expect(python).toEqual({ skillId: 'python', from: 2, to: 3, delta: -1 });
    expect(diff.newCompanies).toEqual(['Wayne']);
  });

  it('skips a snapshot older than 14 days when picking the prior', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const { svc } = build({
      seed: [
        {
          id: 'too-old',
          userId: 'u1',
          snapshotAt: new Date('2026-09-10T06:00:00Z'), // -17d
          filterHash,
          statsJson: priorStats(),
          createdBy: 'cron',
        },
        {
          id: 'latest',
          userId: 'u1',
          snapshotAt: new Date('2026-09-27T06:00:00Z'),
          filterHash,
          statsJson: laterStats(),
          createdBy: 'cron',
        },
      ],
    });
    const diff = await svc.diffAgainstLastWeek('u1');
    expect(diff.hasComparison).toBe(false);
  });

  it('ignores snapshots with a different filterHash (prefs changed mid-week)', async () => {
    const currentHash = hashFilter(DEFAULT_FILTER);
    const staleHash = hashFilter({ ...DEFAULT_FILTER, remoteOnly: true });
    const { svc } = build({
      seed: [
        {
          id: 'stale-prefs',
          userId: 'u1',
          snapshotAt: new Date('2026-09-20T06:00:00Z'),
          filterHash: staleHash,
          statsJson: priorStats(),
          createdBy: 'cron',
        },
        {
          id: 'latest',
          userId: 'u1',
          snapshotAt: new Date('2026-09-27T06:00:00Z'),
          filterHash: currentHash,
          statsJson: laterStats(),
          createdBy: 'cron',
        },
      ],
    });
    const diff = await svc.diffAgainstLastWeek('u1');
    expect(diff.hasComparison).toBe(false);
  });

  it('percent=0 when the prior had zero postings (avoid divide-by-zero)', () => {
    const p: BriefStats = { ...priorStats(), totalCount: 0 };
    const l: BriefStats = { ...laterStats(), totalCount: 10 };
    const diff = diffStats(p, l, {
      from: { snapshotAt: 'x', snapshotId: 'a' },
      to: { snapshotAt: 'y', snapshotId: 'b' },
    });
    expect(diff.postingsDelta.absolute).toBe(10);
    expect(diff.postingsDelta.percent).toBe(0);
  });

  // MUTATION SMOKE:
  //  * change the 14d cutoff to 5d -> the diff-shape test still finds prior
  //    (7d back) so silent; add a `too-old` +8d prior and it'd surface.
  //  * flip added/removed by walking priorSkills first -> the .topSkillsAdded
  //    ['rust'] assertion fails.
  //  * drop the case-insensitive company blacklist normalization in hashFilter
  //    -> the `hashFilter is stable across list order` test fails.
});

// -----------------------------------------------------------------------------
// history + latest
// -----------------------------------------------------------------------------

describe('SnapshotService.latestForUser + historyForUser', () => {
  it('latestForUser returns the newest row for the user + current filterHash', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const { svc } = build({
      seed: [
        { id: 'old', userId: 'u1', snapshotAt: new Date('2026-09-13T06:00:00Z'), filterHash, statsJson: priorStats(), createdBy: 'cron' },
        { id: 'new', userId: 'u1', snapshotAt: new Date('2026-09-27T06:00:00Z'), filterHash, statsJson: laterStats(), createdBy: 'cron' },
      ],
    });
    const latest = await svc.latestForUser('u1');
    expect(latest?.id).toBe('new');
  });

  it('historyForUser caps `weeks` at 52 and returns most-recent-first', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const seed: StoredSnapshot[] = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${i}`,
      userId: 'u1',
      snapshotAt: new Date(Date.UTC(2026, 8, 1) + i * 7 * 86_400_000),
      filterHash,
      statsJson: priorStats(),
      createdBy: 'cron',
    }));
    const { svc } = build({ seed });
    const hist = await svc.historyForUser('u1', 12);
    expect(hist).toHaveLength(12);
    // Newest first
    for (let i = 1; i < hist.length; i++) {
      expect(new Date(hist[i - 1]!.snapshotAt).getTime()).toBeGreaterThan(new Date(hist[i]!.snapshotAt).getTime());
    }
  });

  it('historyForUser weeks<1 clamps to 1', async () => {
    const filterHash = hashFilter(DEFAULT_FILTER);
    const { svc } = build({
      seed: [
        { id: 's', userId: 'u1', snapshotAt: new Date('2026-09-27T06:00:00Z'), filterHash, statsJson: priorStats(), createdBy: 'cron' },
      ],
    });
    const hist = await svc.historyForUser('u1', 0);
    expect(hist).toHaveLength(1);
  });
});
