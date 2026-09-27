// C-P3.4: weekly market snapshots + week-over-week diff.
//
// Two callers write snapshots:
//   * cron (Monday 06:00 UTC) - writes per-user + one shared-default row
//   * user manual (POST /me/market/snapshot) - writes per-user
//
// A snapshot is just the computeStatsFn output persisted, so the diff logic
// stays pure JS map math (no LLM, no I/O beyond the two Prisma finds).
import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobPreferencesService, type JobPreferencesDto } from '../job-prefs/job-prefs.service';
import { computeStatsFn, type BriefStats } from './market-brief.service';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;
/** Pool cutoff used by both brief + snapshot - matches market-brief.service.ts:338. */
const POOL_CUTOFF_DAYS = 45;
/** Pool row cap - see ponytail note in market-brief.service.ts (500 is enough
 *  for the top-N stats today, upgrade when it visibly clips top skills). */
const POOL_ROW_CAP = 500;

/** Default filter used by the cron when no user prefs exist - "all jobs
 *  fresh in the last 45d". Same shape as JobPreferencesDto but zero rules. */
export const DEFAULT_FILTER: SnapshotFilter = {
  remoteOnly: false,
  mustHaveSkills: [],
  dealbreakerSkills: [],
  companyBlacklist: [],
};

export interface SnapshotFilter {
  remoteOnly: boolean;
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  companyBlacklist: string[];
}

export interface MarketSnapshotRow {
  id: string;
  userId: string | null;
  snapshotAt: string;
  filterHash: string;
  createdBy: string;
  stats: BriefStats;
}

export interface TrendDiff {
  hasComparison: boolean;
  reason?: string;
  from?: { snapshotAt: string; snapshotId: string };
  to?: { snapshotAt: string; snapshotId: string };
  postingsDelta: { absolute: number; percent: number };
  remoteShareDelta: number;
  medianCompDelta: number; // C-P3.3 comp-band-usd wiring lands with the classifier;
                           //           snapshot stores 0 today. Kept in the shape so
                           //           the FE contract holds when C-P3.3 backfills.
  topSkillsAdded: string[];
  topSkillsRemoved: string[];
  topSkillsRankChange: Array<{ skillId: string; from: number; to: number; delta: number }>;
  newCompanies: string[];
}

const EMPTY_DIFF: TrendDiff = {
  hasComparison: false,
  postingsDelta: { absolute: 0, percent: 0 },
  remoteShareDelta: 0,
  medianCompDelta: 0,
  topSkillsAdded: [],
  topSkillsRemoved: [],
  topSkillsRankChange: [],
  newCompanies: [],
};

/**
 * Deterministic hash of the pref set that materially affects the pool
 * (loadFilteredPool in market-brief.service.ts uses exactly these fields).
 * Sort every list first so upsert order doesn't shift the hash.
 */
export function hashFilter(f: SnapshotFilter): string {
  const canonical = {
    remoteOnly: f.remoteOnly,
    mustHaveSkills: [...f.mustHaveSkills].sort(),
    dealbreakerSkills: [...f.dealbreakerSkills].sort(),
    companyBlacklist: [...f.companyBlacklist].map((s) => s.toLowerCase().trim()).sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Project a JobPreferencesDto onto the SnapshotFilter subset. */
export function prefsToFilter(prefs: JobPreferencesDto): SnapshotFilter {
  return {
    remoteOnly: prefs.remoteOnly,
    mustHaveSkills: prefs.mustHaveSkills,
    dealbreakerSkills: prefs.dealbreakerSkills,
    companyBlacklist: prefs.companyBlacklist,
  };
}

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: JobPreferencesService,
  ) {}

  /**
   * Load a filtered pool + compute stats. No I/O beyond the one findMany.
   * Shares the same 45d cutoff + 500-row cap as market-brief.service.ts so
   * the numbers a snapshot persists match what the on-demand brief would see.
   */
  async computeSnapshot(
    filter: SnapshotFilter,
  ): Promise<{ stats: BriefStats; filterHash: string }> {
    const cutoff = new Date(Date.now() - POOL_CUTOFF_DAYS * DAY_MS);
    const rows = await this.prisma.normalizedJob.findMany({
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

    const windowStart = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
    const stats = computeStatsFn(pool, windowStart);
    return { stats, filterHash: hashFilter(filter) };
  }

  /**
   * Persist a snapshot. Upsert-shaped so a manual retry on the same day is
   * idempotent (the unique index on day + filterHash + coalesced userId is
   * what actually enforces this - we use `upsert` on that natural key).
   */
  async writeSnapshot(
    userId: string | null,
    filter: SnapshotFilter,
    source: 'cron' | 'manual',
  ): Promise<MarketSnapshotRow> {
    const { stats, filterHash } = await this.computeSnapshot(filter);
    const now = new Date();
    // The unique index is on (date_trunc('day', snapshotAt), filterHash,
    // coalesced userId) - which prisma can't express as a natural key. So we
    // check-then-insert (with the race narrowed by the DB constraint).
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const existing = await this.prisma.marketSnapshot.findFirst({
      where: {
        userId,
        filterHash,
        snapshotAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (existing) {
      const updated = await this.prisma.marketSnapshot.update({
        where: { id: existing.id },
        data: { statsJson: stats as unknown as Prisma.InputJsonValue, createdBy: source },
      });
      return this.toRow(updated);
    }
    const created = await this.prisma.marketSnapshot.create({
      data: {
        userId,
        filterHash,
        statsJson: stats as unknown as Prisma.InputJsonValue,
        createdBy: source,
      },
    });
    return this.toRow(created);
  }

  /** Most-recent snapshot for a user's current filter (nullable). */
  async latestForUser(userId: string): Promise<MarketSnapshotRow | null> {
    const prefs = await this.prefs.get(userId);
    const filterHash = hashFilter(prefsToFilter(prefs));
    const row = await this.prisma.marketSnapshot.findFirst({
      where: { userId, filterHash },
      orderBy: { snapshotAt: 'desc' },
    });
    return row ? this.toRow(row) : null;
  }

  /** Headers-only list of the last `weeks` snapshots for a user. */
  async historyForUser(userId: string, weeks: number): Promise<MarketSnapshotRow[]> {
    const cap = Math.max(1, Math.min(52, Math.floor(weeks)));
    const prefs = await this.prefs.get(userId);
    const filterHash = hashFilter(prefsToFilter(prefs));
    const rows = await this.prisma.marketSnapshot.findMany({
      where: { userId, filterHash },
      orderBy: { snapshotAt: 'desc' },
      take: cap,
    });
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Diff the most-recent snapshot against one taken 7-14 days ago (same
   * filterHash). Returns EMPTY_DIFF with `hasComparison=false` when either
   * side is missing so the FE can render "no comparison yet" without a
   * server error.
   */
  async diffAgainstLastWeek(userId: string): Promise<TrendDiff> {
    const prefs = await this.prefs.get(userId);
    const filterHash = hashFilter(prefsToFilter(prefs));
    const latest = await this.prisma.marketSnapshot.findFirst({
      where: { userId, filterHash },
      orderBy: { snapshotAt: 'desc' },
    });
    if (!latest) return { ...EMPTY_DIFF, reason: 'no snapshot yet' };
    const priorWindowEnd = new Date(latest.snapshotAt.getTime() - 7 * DAY_MS);
    const priorWindowStart = new Date(latest.snapshotAt.getTime() - 14 * DAY_MS);
    const prior = await this.prisma.marketSnapshot.findFirst({
      where: {
        userId,
        filterHash,
        snapshotAt: { gte: priorWindowStart, lte: priorWindowEnd },
      },
      orderBy: { snapshotAt: 'desc' },
    });
    if (!prior) {
      return { ...EMPTY_DIFF, reason: 'no comparable snapshot within 7-14 days ago' };
    }
    return diffStats(
      prior.statsJson as unknown as BriefStats,
      latest.statsJson as unknown as BriefStats,
      {
        from: { snapshotAt: prior.snapshotAt.toISOString(), snapshotId: prior.id },
        to: { snapshotAt: latest.snapshotAt.toISOString(), snapshotId: latest.id },
      },
    );
  }

  private toRow(r: {
    id: string;
    userId: string | null;
    snapshotAt: Date;
    filterHash: string;
    createdBy: string;
    statsJson: Prisma.JsonValue;
  }): MarketSnapshotRow {
    return {
      id: r.id,
      userId: r.userId,
      snapshotAt: r.snapshotAt.toISOString(),
      filterHash: r.filterHash,
      createdBy: r.createdBy,
      stats: r.statsJson as unknown as BriefStats,
    };
  }
}

/**
 * Pure diff. Exported so the worker + tests can call it without instantiating
 * the service.
 */
export function diffStats(
  prior: BriefStats,
  latest: BriefStats,
  refs: { from: { snapshotAt: string; snapshotId: string }; to: { snapshotAt: string; snapshotId: string } },
): TrendDiff {
  const priorSkills = new Map(prior.topSkills.map((s, i) => [s.skillId, i]));
  const latestSkills = new Map(latest.topSkills.map((s, i) => [s.skillId, i]));

  const topSkillsAdded: string[] = [];
  const topSkillsRemoved: string[] = [];
  const rankChange: TrendDiff['topSkillsRankChange'] = [];

  for (const [skillId, toIdx] of latestSkills) {
    const fromIdx = priorSkills.get(skillId);
    if (fromIdx === undefined) {
      topSkillsAdded.push(skillId);
    } else if (fromIdx !== toIdx) {
      rankChange.push({ skillId, from: fromIdx, to: toIdx, delta: fromIdx - toIdx });
    }
  }
  for (const [skillId] of priorSkills) {
    if (!latestSkills.has(skillId)) topSkillsRemoved.push(skillId);
  }
  // Sort rankChange by absolute movement, desc (top movers first).
  rankChange.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const priorCompanies = new Set(prior.topCompanies.map((c) => c.company));
  const newCompanies = latest.topCompanies
    .map((c) => c.company)
    .filter((c) => !priorCompanies.has(c));

  const absolute = latest.totalCount - prior.totalCount;
  const percent = prior.totalCount === 0 ? 0 : absolute / prior.totalCount;

  return {
    hasComparison: true,
    from: refs.from,
    to: refs.to,
    postingsDelta: { absolute, percent },
    remoteShareDelta: latest.remoteShare - prior.remoteShare,
    // ponytail: C-P3.3 comp-band-usd hasn't landed yet; snapshot stats don't
    // carry medianCompUsd. When it does, plumb it through BriefStats and
    // subtract here. Zero keeps the shape stable in the meantime.
    medianCompDelta: 0,
    topSkillsAdded,
    topSkillsRemoved,
    topSkillsRankChange: rankChange,
    newCompanies,
  };
}
