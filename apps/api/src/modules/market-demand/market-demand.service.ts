import { Injectable } from '@nestjs/common';
import type {
  SkillDemandResponse,
  SkillDemandRow,
  TrendSignal,
  TrendSignalsResponse,
} from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import { jobMatchesMarketScope, marketScope } from './market-scope';

const DAY_MS = 86_400_000;
/** Rolling-window ceilings. `POOL_ROW_CAP` mirrors market-brief/snapshot so the
 *  three market surfaces agree on the pool they sample (see ponytail note in
 *  market-brief.service.ts). */
export const DEMAND_DEFAULT_WINDOW_DAYS = 30;
export const DEMAND_MIN_WINDOW_DAYS = 7;
export const DEMAND_MAX_WINDOW_DAYS = 365;
const TREND_WINDOW_DAYS = 90;
const TREND_RECENT_DAYS = 30;
const POOL_ROW_CAP = 500;
const TOP_N = 25;
/** Sparkline buckets across a window. 7 keeps every series short + readable. */
const BUCKETS = 7;
/** Ratio bands for trajectory — blueprint §9: ±20% vs the prior baseline. */
const RISING_RATIO = 1.2;
const DECLINING_RATIO = 0.8;

/** Minimal job projection both compute functions operate on. */
export interface DemandJob {
  skillIds: string[];
  company: string;
  remote: boolean;
  primarySource: string;
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
  /** P1 structured geo; optional so the pure projections don't require it. */
  country?: string | null;
  region?: string | null;
  workplaceType?: string | null;
  remoteScope?: string | null;
}

export interface SkillMeta {
  id: string;
  name: string;
  category: string | null;
  cluster: string | null;
}

@Injectable()
export class MarketDemandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: JobPreferencesService,
  ) {}

  /** Screen 33. Jobs in `windowDays` → per-skill postings/share/history/gap. */
  async skillDemand(userId: string, windowDays: number): Promise<SkillDemandResponse> {
    const now = new Date();
    const jobs = await this.loadPool(userId, windowDays, now);
    if (jobs.length === 0) return { windowDays, rows: [] };

    const { skills, levels } = await this.loadSkillMeta(userId, uniqueSkillIds(jobs));
    return {
      windowDays,
      rows: computeSkillDemand(jobs, skills, levels, windowDays, now),
    };
  }

  /** Screen 34. 90-day job mentions → rising/steady/declining signals. */
  async trendSignals(userId: string): Promise<TrendSignalsResponse> {
    const now = new Date();
    const jobs = await this.loadPool(userId, TREND_WINDOW_DAYS, now);
    if (jobs.length === 0) return { generatedAt: now.toISOString(), signals: [] };

    const { skills } = await this.loadSkillMeta(userId, uniqueSkillIds(jobs));
    return {
      generatedAt: now.toISOString(),
      signals: computeTrendSignals(jobs, skills, now),
    };
  }

  /**
   * Geo-scoped demand histogram consumed by `LearningPriorityService` (P2 §8
   * unification): the same preference- + geo-filtered pool the demand table
   * uses, reduced to `skillId → posting count`. This replaces learning-priority's
   * old direct `normalizedJob` query — which applied NO prefs/geo filters — so
   * the two surfaces can no longer disagree.
   */
  async demandBySkill(
    userId: string,
    windowDays: number,
    now: Date = new Date(),
  ): Promise<Map<string, number>> {
    const jobs = await this.loadPool(userId, windowDays, now);
    const demand = new Map<string, number>();
    for (const job of jobs) {
      for (const skillId of job.skillIds) {
        demand.set(skillId, (demand.get(skillId) ?? 0) + 1);
      }
    }
    return demand;
  }

  /**
   * Preference- and geo-filtered, freshness-bounded pool shared by both
   * endpoints. Shape mirrors `market-brief.service.ts::loadFilteredPool` (same
   * 500-row pre-filter cap + same user rules + same market scope) so a demand
   * table and a brief never disagree on the pool they describe.
   */
  private async loadPool(userId: string, windowDays: number, now: Date): Promise<DemandJob[]> {
    const prefs = await this.prefs.get(userId);
    const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
    const rows = await this.prisma.normalizedJob.findMany({
      where: {
        AND: [
          {
            OR: [
              { sourcePostedAt: { gte: cutoff } },
              { sourcePostedAt: null, firstSeenAt: { gte: cutoff } },
            ],
          },
          prefs.remoteOnly ? { remote: true } : {},
        ],
      },
      orderBy: [{ sourcePostedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
      take: POOL_ROW_CAP,
    });
    const blacklist = new Set(prefs.companyBlacklist.map((c) => c.toLowerCase().trim()));
    const mustHave = new Set(prefs.mustHaveSkills);
    const dealbreakers = new Set(prefs.dealbreakerSkills);
    const scope = marketScope(prefs.countries, prefs.workplaceTypes, prefs.remoteScopes);
    return rows.filter((r) => {
      // Geo scope first: a job in another market is not demand here, and a
      // null-geo job is excluded (reason available from `jobMatchesMarketScope`)
      // when an axis is constrained — never counted as a match.
      if (!jobMatchesMarketScope(scope, r).inScope) return false;
      if (blacklist.has(r.company.toLowerCase().trim())) return false;
      const jobSkills = new Set(r.skillIds);
      for (const d of dealbreakers) if (jobSkills.has(d)) return false;
      for (const m of mustHave) if (!jobSkills.has(m)) return false;
      return true;
    });
  }

  private async loadSkillMeta(
    userId: string,
    skillIds: string[],
  ): Promise<{ skills: Map<string, SkillMeta>; levels: Map<string, number> }> {
    if (skillIds.length === 0) return { skills: new Map(), levels: new Map() };
    const [catalogue, states] = await Promise.all([
      this.prisma.skill.findMany({
        where: { id: { in: skillIds } },
        select: { id: true, name: true, category: true, cluster: true },
      }),
      this.prisma.candidateSkillState.findMany({
        where: { userId, skillId: { in: skillIds } },
        select: { skillId: true, level: true },
      }),
    ]);
    return {
      skills: new Map(catalogue.map((s) => [s.id, s])),
      levels: new Map(states.map((s) => [s.skillId, Number(s.level)])),
    };
  }
}

function uniqueSkillIds(jobs: DemandJob[]): string[] {
  const ids = new Set<string>();
  for (const j of jobs) for (const s of j.skillIds) ids.add(s);
  return [...ids];
}

function postedAt(job: DemandJob): Date {
  return job.sourcePostedAt ?? job.firstSeenAt;
}

function bucketIndex(posted: Date, start: Date, now: Date): number {
  const span = now.getTime() - start.getTime();
  const bucketMs = span > 0 ? span / BUCKETS : 1;
  const clamped = Math.min(Math.max(posted.getTime(), start.getTime()), now.getTime());
  return Math.min(BUCKETS - 1, Math.floor((clamped - start.getTime()) / bucketMs));
}

/**
 * Pure screen-33 projection. `gap = max(0, demandScore - level)` where
 * `demandScore = round(share * 100)` and `level` is the caller's demonstrated
 * `CandidateSkillState.level` (0 when no state exists). It is a documented
 * proxy for the evidence model's distance-to-threshold, not a target-role
 * threshold (no role thresholds are persisted yet).
 */
export function computeSkillDemand(
  jobs: DemandJob[],
  skills: Map<string, SkillMeta>,
  levels: Map<string, number>,
  windowDays: number,
  now: Date,
): SkillDemandRow[] {
  const total = jobs.length;
  if (total === 0) return [];
  const start = new Date(now.getTime() - windowDays * DAY_MS);

  const counts = new Map<string, number>();
  const series = new Map<string, number[]>();
  for (const job of jobs) {
    const idx = bucketIndex(postedAt(job), start, now);
    for (const skillId of job.skillIds) {
      counts.set(skillId, (counts.get(skillId) ?? 0) + 1);
      const arr = series.get(skillId) ?? new Array<number>(BUCKETS).fill(0);
      arr[idx] = (arr[idx] ?? 0) + 1;
      series.set(skillId, arr);
    }
  }

  return [...counts.entries()]
    .map(([skillId, postings]) => {
      const meta = skills.get(skillId);
      const share = postings / total;
      const level = levels.get(skillId) ?? 0;
      return {
        skillId,
        label: meta?.name ?? skillId,
        cluster: meta?.category ?? meta?.cluster ?? 'uncategorized',
        postings,
        share,
        history: series.get(skillId) ?? new Array<number>(BUCKETS).fill(0),
        gap: Math.max(0, Math.round(share * 100) - level),
      } satisfies SkillDemandRow;
    })
    .sort((a, b) => b.postings - a.postings)
    .slice(0, TOP_N);
}

/**
 * Pure screen-34 projection. Trajectory compares the last 30 days against the
 * prior 60-day baseline normalized to a 30-day rate (+20% rising / −20%
 * declining). A missing baseline plus any recent mention reads as rising.
 * `sources` counts distinct adapters, not URLs, so it never inflates.
 */
export function computeTrendSignals(
  jobs: DemandJob[],
  skills: Map<string, SkillMeta>,
  now: Date,
): TrendSignal[] {
  const start = new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS);
  const recentCutoff = now.getTime() - TREND_RECENT_DAYS * DAY_MS;

  interface Acc {
    mentions: number;
    recent: number;
    firstSeen: Date;
    sources: Set<string>;
    history: number[];
  }
  const acc = new Map<string, Acc>();
  for (const job of jobs) {
    const posted = postedAt(job);
    const idx = bucketIndex(posted, start, now);
    const isRecent = posted.getTime() >= recentCutoff;
    for (const skillId of job.skillIds) {
      const a = acc.get(skillId) ?? {
        mentions: 0,
        recent: 0,
        firstSeen: posted,
        sources: new Set<string>(),
        history: new Array<number>(BUCKETS).fill(0),
      };
      a.mentions += 1;
      if (isRecent) a.recent += 1;
      if (posted < a.firstSeen) a.firstSeen = posted;
      a.sources.add(job.primarySource);
      a.history[idx] = (a.history[idx] ?? 0) + 1;
      acc.set(skillId, a);
    }
  }

  return [...acc.entries()]
    .map(([skillId, a]) => {
      const meta = skills.get(skillId);
      // Prior 60 days normalized to a 30-day rate (two 30-day periods).
      const baselinePer30 = (a.mentions - a.recent) / 2;
      const trajectory: TrendSignal['trajectory'] =
        baselinePer30 === 0
          ? a.recent > 0
            ? 'rising'
            : 'steady'
          : a.recent / baselinePer30 >= RISING_RATIO
            ? 'rising'
            : a.recent / baselinePer30 <= DECLINING_RATIO
              ? 'declining'
              : 'steady';
      return {
        id: skillId,
        technology: meta?.name ?? skillId,
        category: meta?.category ?? meta?.cluster ?? 'uncategorized',
        mentions: a.mentions,
        sources: a.sources.size,
        firstSeen: a.firstSeen.toISOString().slice(0, 10),
        trajectory,
        history: a.history,
      } satisfies TrendSignal;
    })
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, TOP_N);
}
