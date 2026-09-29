import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E.3 (Wave E / P5): daily-brief composer.
 *
 * Pulls a small, side-effect-free snapshot per phase-5:41-43:
 *   - Level + XP delta since 24h ago
 *   - Top 3 open quests / remediation tasks
 *   - 3-5 recent job matches (last 24h)
 *   - Streak status (current + longest)
 *   - Market-pulse one-liner (rising skill from most recent snapshot)
 *
 * The composer NEVER writes state. The scheduler writes lastSentAt +
 * an audit entry after a successful send; a failed send does not.
 *
 * Output is a plain JSON payload the ChannelRegistry hands to whatever
 * Channel the user opted into. Block Kit conversion happens elsewhere
 * (a future SlackChannel adapter builds blocks from this payload).
 *
 * ponytail: no LLM call. Every field here is a numeric or an existing
 * label from other tables - grounded generation not needed, sources
 * link back to the app.
 */

export interface DailyBriefPayload {
  userId: string;
  composedAt: string;
  xp: {
    totalXp: number;
    deltaLast24h: number;
  };
  streak: {
    currentDays: number;
    longestDays: number;
  };
  quests: Array<{
    id: string;
    title: string;
    skillName: string | null;
    dueAt: string | null;
  }>;
  jobMatches: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    postedAt: string | null;
  }>;
  marketPulse: {
    risingSkill: string | null;
    snapshotAt: string | null;
  } | null;
}

@Injectable()
export class DailyBriefComposerService {
  constructor(private readonly prisma: PrismaService) {}

  async compose(userId: string, now: Date = new Date()): Promise<DailyBriefPayload> {
    const dayAgo = new Date(now.getTime() - 86_400_000);

    const [xpAll, xpDelta, streak, quests, applications, snapshot] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.prisma.xpEvent.aggregate({
        where: { userId, createdAt: { gte: dayAgo } },
        _sum: { xp: true },
      }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.prisma.remediationTask.findMany({
        where: { userId, status: 'open' },
        orderBy: { createdAt: 'asc' },
        take: 3,
        select: { id: true, reason: true, skillId: true, createdAt: true },
      }),
      this.prisma.application.findMany({
        where: { userId, createdAt: { gte: dayAgo } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, jobId: true, createdAt: true },
      }),
      this.prisma.marketSnapshot.findFirst({
        where: { userId },
        orderBy: { snapshotAt: 'desc' },
        select: { snapshotAt: true, statsJson: true },
      }),
    ]);

    // Two follow-up in-memory joins: RemediationTask -> Skill.name, and
    // Application -> NormalizedJob.{title,company,location,sourcePostedAt}.
    // Prisma has no relation for either edge here (skill relation on
    // RemediationTask is not declared; Application.jobId is a bare uuid),
    // so a batched findMany + Map lookup is the shortest correct path.
    const [skills, jobs] = await Promise.all([
      quests.length > 0
        ? this.prisma.skill.findMany({
            where: { id: { in: quests.map((q) => q.skillId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      applications.length > 0
        ? this.prisma.normalizedJob.findMany({
            where: { id: { in: applications.map((a) => a.jobId) } },
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              sourcePostedAt: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string;
              title: string;
              company: string;
              location: string | null;
              sourcePostedAt: Date | null;
            }>,
          ),
    ]);
    const skillById = new Map(skills.map((s) => [s.id, s.name]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    return {
      userId,
      composedAt: now.toISOString(),
      xp: {
        totalXp: xpAll._sum.xp ?? 0,
        deltaLast24h: xpDelta._sum.xp ?? 0,
      },
      streak: {
        currentDays: streak?.currentDays ?? 0,
        longestDays: streak?.longestDays ?? 0,
      },
      quests: quests.map((q) => ({
        id: q.id,
        title: q.reason,
        skillName: skillById.get(q.skillId) ?? null,
        dueAt: null,
      })),
      jobMatches: applications.map((a) => {
        const job = jobById.get(a.jobId);
        return {
          id: a.id,
          title: job?.title ?? '',
          company: job?.company ?? null,
          location: job?.location ?? null,
          postedAt: (job?.sourcePostedAt ?? a.createdAt).toISOString(),
        };
      }),
      marketPulse: snapshot
        ? {
            risingSkill: extractTopRiser(snapshot.statsJson),
            snapshotAt: snapshot.snapshotAt.toISOString(),
          }
        : null,
    };
  }
}

/**
 * `MarketSnapshot.statsJson` shape per C-P3.4 is `{topSkills, topCompanies,
 * ...}`. topSkills is an Array<{skillName, count, ...}> in the shipped
 * writer; the first element is our "riser" for now. Be defensive so a
 * schema drift does not crash the daily brief.
 */
function extractTopRiser(statsJson: unknown): string | null {
  if (!statsJson || typeof statsJson !== 'object') return null;
  const top = (statsJson as Record<string, unknown>).topSkills;
  if (!Array.isArray(top) || top.length === 0) return null;
  const first = top[0] as Record<string, unknown>;
  const name = first?.skillName;
  return typeof name === 'string' ? name : null;
}
