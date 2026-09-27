// C-P3.4d: weekly market snapshot cron.
//
// Every Monday 06:00 UTC:
//   1. compute + write ONE shared-default snapshot (userId=null) - "all jobs fresh 45d"
//   2. for every user that has UserJobPreferences, compute + write their per-user snapshot
//
// The compute path mirrors apps/api/src/modules/market-brief/snapshot.service.ts
// (see hashFilter, prefsToFilter, computeStatsFn, writeSnapshot) - kept
// inline here because the worker package can't import from apps/api. Both
// impls need to stay behavior-identical; the assert-parity test in
// market-snapshot.worker.test.ts pins the compute output on a shared fixture.
import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';

export const QUEUE_MARKET_SNAPSHOT = 'market-snapshot-weekly';
export const JOB_MARKET_SNAPSHOT = 'market-snapshot-weekly';
/** Monday 06:00 UTC. Off-hour to leave the retention (03:17) + corpus (Sun 04:00) slots. */
export const MARKET_SNAPSHOT_CRON = '0 6 * * 1';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;
const POOL_CUTOFF_DAYS = 45;
const POOL_ROW_CAP = 500;
const TOP_N = 10;

// ---------------------------------------------------------------------------
// Types (kept structural so tests stub with plain objects)
// ---------------------------------------------------------------------------

export interface SnapshotFilter {
  remoteOnly: boolean;
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  companyBlacklist: string[];
}

export const DEFAULT_FILTER: SnapshotFilter = {
  remoteOnly: false,
  mustHaveSkills: [],
  dealbreakerSkills: [],
  companyBlacklist: [],
};

export interface BriefStats {
  windowDays: number;
  totalCount: number;
  newCount: number;
  remoteShare: number;
  topSkills: Array<{ skillId: string; count: number }>;
  topCompanies: Array<{ company: string; count: number }>;
}

/** Narrow structural shape - `main.ts` passes a real PrismaClient; tests stub. */
export interface MarketSnapshotRepo {
  normalizedJob: {
    findMany: (args: {
      where: unknown;
      orderBy: unknown;
      take: number;
    }) => Promise<Array<{
      company: string;
      remote: boolean;
      skillIds: string[];
      sourcePostedAt: Date | null;
      firstSeenAt: Date;
    }>>;
  };
  userJobPreferences: {
    findMany: (args?: unknown) => Promise<Array<{
      userId: string;
      remoteOnly: boolean;
      mustHaveSkills: string[];
      dealbreakerSkills: string[];
      companyBlacklist: string[];
    }>>;
  };
  marketSnapshot: {
    findFirst: (args: {
      where: {
        userId: string | null;
        filterHash: string;
        snapshotAt?: { gte: Date; lt: Date };
      };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        userId: string | null;
        filterHash: string;
        statsJson: Prisma.InputJsonValue;
        createdBy: string;
      };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: { statsJson: Prisma.InputJsonValue; createdBy: string };
    }) => Promise<{ id: string }>;
  };
}

// ---------------------------------------------------------------------------
// Pure helpers - duplicated from snapshot.service.ts (see file header note)
// ---------------------------------------------------------------------------

export function hashFilter(f: SnapshotFilter): string {
  const canonical = {
    remoteOnly: f.remoteOnly,
    mustHaveSkills: [...f.mustHaveSkills].sort(),
    dealbreakerSkills: [...f.dealbreakerSkills].sort(),
    companyBlacklist: [...f.companyBlacklist].map((s) => s.toLowerCase().trim()).sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function computeStatsFn(
  pool: Array<{ skillIds: string[]; company: string; remote: boolean; sourcePostedAt: Date | null; firstSeenAt: Date }>,
  windowStart: Date,
): BriefStats {
  const skillCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  let remoteCount = 0;
  let newCount = 0;
  for (const j of pool) {
    for (const s of j.skillIds) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
    companyCounts.set(j.company, (companyCounts.get(j.company) ?? 0) + 1);
    if (j.remote) remoteCount++;
    const posted = j.sourcePostedAt ?? j.firstSeenAt;
    if (posted >= windowStart) newCount++;
  }
  const sortDesc = <T>(entries: Array<[T, number]>) =>
    entries.sort((a, b) => b[1] - a[1]).slice(0, TOP_N);
  return {
    windowDays: WINDOW_DAYS,
    totalCount: pool.length,
    newCount,
    remoteShare: pool.length === 0 ? 0 : remoteCount / pool.length,
    topSkills: sortDesc([...skillCounts.entries()]).map(([skillId, count]) => ({ skillId, count })),
    topCompanies: sortDesc([...companyCounts.entries()]).map(([company, count]) => ({ company, count })),
  };
}

// ---------------------------------------------------------------------------
// Snapshot write path
// ---------------------------------------------------------------------------

async function computeAndWrite(
  prisma: MarketSnapshotRepo,
  userId: string | null,
  filter: SnapshotFilter,
): Promise<{ userId: string | null; filterHash: string; created: boolean }> {
  const cutoff = new Date(Date.now() - POOL_CUTOFF_DAYS * DAY_MS);
  const rows = await prisma.normalizedJob.findMany({
    where: {
      AND: [
        {
          OR: [
            { sourcePostedAt: { gte: cutoff } },
            { sourcePostedAt: null, firstSeenAt: { gte: cutoff } },
          ],
        },
        filter.remoteOnly ? { remote: true } : {},
      ],
    },
    orderBy: [
      { sourcePostedAt: { sort: 'desc', nulls: 'last' } },
      { firstSeenAt: 'desc' },
    ],
    take: POOL_ROW_CAP,
  });
  const blacklist = new Set(filter.companyBlacklist.map((c) => c.toLowerCase().trim()));
  const mustHave = new Set(filter.mustHaveSkills);
  const dealbreakers = new Set(filter.dealbreakerSkills);
  const pool = rows.filter((r) => {
    if (blacklist.has(r.company.toLowerCase().trim())) return false;
    const jobSkills = new Set(r.skillIds);
    for (const d of dealbreakers) if (jobSkills.has(d)) return false;
    for (const m of mustHave) if (!jobSkills.has(m)) return false;
    return true;
  });
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const stats = computeStatsFn(pool, windowStart);
  const filterHash = hashFilter(filter);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const existing = await prisma.marketSnapshot.findFirst({
    where: { userId, filterHash, snapshotAt: { gte: dayStart, lt: dayEnd } },
  });
  if (existing) {
    await prisma.marketSnapshot.update({
      where: { id: existing.id },
      data: { statsJson: stats as unknown as Prisma.InputJsonValue, createdBy: 'cron' },
    });
    return { userId, filterHash, created: false };
  }
  await prisma.marketSnapshot.create({
    data: {
      userId,
      filterHash,
      statsJson: stats as unknown as Prisma.InputJsonValue,
      createdBy: 'cron',
    },
  });
  return { userId, filterHash, created: true };
}

// ---------------------------------------------------------------------------
// Weekly job body: default-filter row + one row per user
// ---------------------------------------------------------------------------

export interface WeeklyRunSummary {
  runAt: string;
  users: number;
  snapshotsWritten: number;
  snapshotsUpdated: number;
  errors: number;
}

export async function runWeeklySnapshot(
  prisma: MarketSnapshotRepo,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<WeeklyRunSummary> {
  let written = 0;
  let updated = 0;
  let errors = 0;
  const bump = (r: { created: boolean }) => (r.created ? written++ : updated++);

  try {
    bump(await computeAndWrite(prisma, null, DEFAULT_FILTER));
  } catch (err) {
    errors++;
    logger.error(
      { err: (err as Error).message },
      'market-snapshot: default-filter snapshot failed',
    );
  }

  const users = await prisma.userJobPreferences.findMany();
  for (const u of users) {
    const filter: SnapshotFilter = {
      remoteOnly: u.remoteOnly,
      mustHaveSkills: u.mustHaveSkills,
      dealbreakerSkills: u.dealbreakerSkills,
      companyBlacklist: u.companyBlacklist,
    };
    try {
      bump(await computeAndWrite(prisma, u.userId, filter));
    } catch (err) {
      errors++;
      logger.error(
        { userId: u.userId, err: (err as Error).message },
        'market-snapshot: per-user snapshot failed',
      );
    }
  }

  const summary: WeeklyRunSummary = {
    runAt: new Date().toISOString(),
    users: users.length,
    snapshotsWritten: written + updated,
    errors,
  } as WeeklyRunSummary;
  // Expose the split for observability - `snapshotsWritten` is the total per
  // the plan; the extra fields are pino-only.
  logger.info(
    {
      job: JOB_MARKET_SNAPSHOT,
      users: users.length,
      snapshotsWritten: written + updated,
      snapshotsCreated: written,
      snapshotsUpdated: updated,
      errors,
    },
    'market-snapshot weekly run complete',
  );
  return summary;
}

/** BullMQ handler entrypoint. */
export async function handleMarketSnapshot(
  prisma: PrismaClient,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<WeeklyRunSummary> {
  return runWeeklySnapshot(prisma as unknown as MarketSnapshotRepo, logger);
}
