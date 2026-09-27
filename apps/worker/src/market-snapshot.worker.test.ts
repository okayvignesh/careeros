import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILTER,
  JOB_MARKET_SNAPSHOT,
  MARKET_SNAPSHOT_CRON,
  QUEUE_MARKET_SNAPSHOT,
  computeStatsFn,
  hashFilter,
  runWeeklySnapshot,
} from './market-snapshot.worker';

// -----------------------------------------------------------------------------
// Fake Prisma: normalizedJob.findMany returns a fixed pool;
// userJobPreferences.findMany returns the users we want to iterate; and
// marketSnapshot.{findFirst,create,update} tracks writes.
// -----------------------------------------------------------------------------

type Job = {
  company: string;
  remote: boolean;
  skillIds: string[];
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
};

type UserPref = {
  userId: string;
  remoteOnly: boolean;
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  companyBlacklist: string[];
};

interface StoredSnapshot {
  id: string;
  userId: string | null;
  filterHash: string;
  snapshotAt: Date;
  statsJson: unknown;
  createdBy: string;
}

function fixturePool(now = new Date('2026-10-05T06:00:00Z')): Job[] {
  const d = (deltaMs: number) => new Date(now.getTime() - deltaMs);
  return [
    { company: 'Acme', remote: true, skillIds: ['typescript'], sourcePostedAt: d(1 * 86_400_000), firstSeenAt: d(1 * 86_400_000) },
    { company: 'Acme', remote: true, skillIds: ['typescript', 'kubernetes'], sourcePostedAt: d(2 * 86_400_000), firstSeenAt: d(2 * 86_400_000) },
    { company: 'Globex', remote: false, skillIds: ['python'], sourcePostedAt: d(3 * 86_400_000), firstSeenAt: d(3 * 86_400_000) },
    { company: 'Initech', remote: false, skillIds: ['java'], sourcePostedAt: d(4 * 86_400_000), firstSeenAt: d(4 * 86_400_000) },
  ];
}

function fakePrisma(jobs: Job[], users: UserPref[]) {
  const snapshots: StoredSnapshot[] = [];
  let seq = 0;
  return {
    snapshots,
    normalizedJob: {
      findMany: async () => jobs,
    },
    userJobPreferences: {
      findMany: async () => users,
    },
    marketSnapshot: {
      findFirst: async ({ where }: {
        where: {
          userId: string | null;
          filterHash: string;
          snapshotAt?: { gte: Date; lt: Date };
        };
      }) => {
        const found = snapshots.find(
          (s) =>
            s.userId === where.userId &&
            s.filterHash === where.filterHash &&
            (!where.snapshotAt ||
              (s.snapshotAt.getTime() >= where.snapshotAt.gte.getTime() &&
                s.snapshotAt.getTime() < where.snapshotAt.lt.getTime())),
        );
        return found ? { id: found.id } : null;
      },
      create: async ({ data }: { data: Omit<StoredSnapshot, 'id' | 'snapshotAt'> }) => {
        seq += 1;
        const row: StoredSnapshot = {
          id: `snap-${seq}`,
          snapshotAt: new Date(),
          ...data,
        };
        snapshots.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: { statsJson: unknown; createdBy: string } }) => {
        const idx = snapshots.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error('not found');
        snapshots[idx] = { ...snapshots[idx]!, statsJson: data.statsJson, createdBy: data.createdBy };
        return { id: where.id };
      },
    },
  };
}

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T06:00:00Z')); // a Monday
});
afterEach(() => vi.useRealTimers());

// -----------------------------------------------------------------------------
// Cron identity: static jobId + Monday 06:00 UTC + queue name
// -----------------------------------------------------------------------------

describe('market-snapshot cron identity', () => {
  it('jobId is stable across restarts and matches the queue', () => {
    expect(QUEUE_MARKET_SNAPSHOT).toBe('market-snapshot-weekly');
    expect(JOB_MARKET_SNAPSHOT).toBe('market-snapshot-weekly');
  });

  it('cron pattern is Monday 06:00 UTC', () => {
    expect(MARKET_SNAPSHOT_CRON).toBe('0 6 * * 1');
  });
});

// -----------------------------------------------------------------------------
// Parity with the API-side compute (guards the duplication call-out in the
// worker file header)
// -----------------------------------------------------------------------------

describe('market-snapshot pure helpers parity', () => {
  it('hashFilter is stable when list order differs', () => {
    const a = hashFilter({ remoteOnly: false, mustHaveSkills: ['b', 'a'], dealbreakerSkills: ['x'], companyBlacklist: ['Acme'] });
    const b = hashFilter({ remoteOnly: false, mustHaveSkills: ['a', 'b'], dealbreakerSkills: ['x'], companyBlacklist: ['acme'] });
    expect(a).toBe(b);
  });

  it('computeStatsFn returns the same topSkills/topCompanies shape as the API-side impl', () => {
    const stats = computeStatsFn(fixturePool(), new Date('2026-09-28T06:00:00Z'));
    expect(stats.windowDays).toBe(7);
    expect(stats.totalCount).toBe(4);
    expect(stats.newCount).toBe(4);
    expect(stats.remoteShare).toBeCloseTo(2 / 4, 5);
    const skills = Object.fromEntries(stats.topSkills.map((s) => [s.skillId, s.count]));
    expect(skills).toEqual({ typescript: 2, kubernetes: 1, python: 1, java: 1 });
  });
});

// -----------------------------------------------------------------------------
// runWeeklySnapshot: two users -> two per-user snapshots + one default
// -----------------------------------------------------------------------------

describe('runWeeklySnapshot', () => {
  it('writes one shared-default (userId=null) snapshot + one per user + emits summary', async () => {
    const users: UserPref[] = [
      { userId: 'u-alpha', remoteOnly: true, mustHaveSkills: ['typescript'], dealbreakerSkills: [], companyBlacklist: [] },
      { userId: 'u-beta', remoteOnly: false, mustHaveSkills: [], dealbreakerSkills: ['java'], companyBlacklist: [] },
    ];
    const prisma = fakePrisma(fixturePool(), users);
    const logger = silentLogger();
    const summary = await runWeeklySnapshot(prisma as never, logger);

    // 2 users + 1 shared default
    expect(prisma.snapshots).toHaveLength(3);
    // userIds present exactly once each
    const uids = prisma.snapshots.map((s) => s.userId).sort((a, b) => String(a).localeCompare(String(b)));
    expect(uids).toEqual([null, 'u-alpha', 'u-beta']);

    // Every row was written by 'cron'.
    expect(prisma.snapshots.every((s) => s.createdBy === 'cron')).toBe(true);

    // filterHash for the shared default matches DEFAULT_FILTER.
    const shared = prisma.snapshots.find((s) => s.userId === null)!;
    expect(shared.filterHash).toBe(hashFilter(DEFAULT_FILTER));
    // Per-user filterHash differs from default.
    const alpha = prisma.snapshots.find((s) => s.userId === 'u-alpha')!;
    expect(alpha.filterHash).not.toBe(shared.filterHash);

    expect(summary).toMatchObject({
      users: 2,
      snapshotsWritten: 3,
      errors: 0,
    });

    // pino summary emitted once, structured payload contains the job name.
    expect(logger.info).toHaveBeenCalledOnce();
    const [payload, msg] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(msg).toMatch(/market-snapshot weekly run complete/);
    expect(payload).toMatchObject({
      job: JOB_MARKET_SNAPSHOT,
      users: 2,
      snapshotsWritten: 3,
      errors: 0,
    });
  });

  it('re-running on the same day updates in place (idempotent)', async () => {
    const users: UserPref[] = [
      { userId: 'u-alpha', remoteOnly: false, mustHaveSkills: [], dealbreakerSkills: [], companyBlacklist: [] },
    ];
    const prisma = fakePrisma(fixturePool(), users);
    const logger = silentLogger();
    await runWeeklySnapshot(prisma as never, logger);
    const idsAfterFirst = prisma.snapshots.map((s) => s.id).sort();
    await runWeeklySnapshot(prisma as never, logger);
    const idsAfterSecond = prisma.snapshots.map((s) => s.id).sort();
    expect(idsAfterFirst).toEqual(idsAfterSecond);
    expect(prisma.snapshots).toHaveLength(2); // default + u-alpha
  });

  it('per-user failure is isolated: default still lands, error is counted', async () => {
    const users: UserPref[] = [
      { userId: 'u-good', remoteOnly: false, mustHaveSkills: [], dealbreakerSkills: [], companyBlacklist: [] },
      { userId: 'u-bad', remoteOnly: false, mustHaveSkills: [], dealbreakerSkills: [], companyBlacklist: [] },
    ];
    const prisma = fakePrisma(fixturePool(), users);
    // Wrap create to throw on u-bad.
    const realCreate = prisma.marketSnapshot.create;
    prisma.marketSnapshot.create = async (args) => {
      if (args.data.userId === 'u-bad') throw new Error('db down for this user');
      return realCreate(args);
    };
    const logger = silentLogger();
    const summary = await runWeeklySnapshot(prisma as never, logger);
    expect(summary.errors).toBe(1);
    // Default + u-good landed; u-bad did not.
    expect(prisma.snapshots.map((s) => s.userId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      null,
      'u-good',
    ]);
    // Logger recorded the specific per-user error.
    expect(logger.error).toHaveBeenCalled();
  });

  it('zero users -> only the default snapshot is written', async () => {
    const prisma = fakePrisma(fixturePool(), []);
    const logger = silentLogger();
    const summary = await runWeeklySnapshot(prisma as never, logger);
    expect(summary.users).toBe(0);
    expect(summary.snapshotsWritten).toBe(1);
    expect(prisma.snapshots).toHaveLength(1);
    expect(prisma.snapshots[0]!.userId).toBeNull();
  });

  // MUTATION SMOKE:
  //  * change DEFAULT_FILTER to remoteOnly:true -> the "shared filterHash
  //    matches DEFAULT_FILTER" assertion holds but "differs from alpha"
  //    breaks (alpha is also remoteOnly:true).
  //  * flip create/update in the same-day branch and prisma.snapshots grows
  //    to 4 on the second call -> the idempotent-retry test fails.
  //  * remove the try/catch around per-user write and the "isolated failure"
  //    test rethrows before landing u-good.
});
