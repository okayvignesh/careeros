import { Injectable } from '@nestjs/common';
import { levelFromXp } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

// Whitelist of IANA tz strings we accept. Postgres `AT TIME ZONE` is happy with the same set;
// anything else falls back to UTC. Keeping this static avoids injecting user input into raw SQL.
const KNOWN_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
function safeTz(tz: string | undefined): string {
  return tz && KNOWN_TIMEZONES.has(tz) ? tz : 'UTC';
}

export interface DashboardKpis {
  skillsTracked: number;
  skillsCatalog: number;
  evidenceRows: number;
  reposAnalyzed: number;
  factsVerified: number;
  factsTotal: number;
}

export interface LevelSummary {
  overallLevel: number; // 1..100, derived from totalXp so the bar can't drift
  totalXp: number; // evidence rows weighted by kind
  streakDays: number; // consecutive days with ≥1 evidence in the user's timezone
  topLevel: number; // highest single skill level (informational)
  timezone: string; // echoed so the client knows which tz was used
}

export interface RecentEvidenceRow {
  id: string;
  skillId: string;
  skillName: string;
  kind: string;
  signal: string;
  observedAt: string;
  sourceKind: string | null;
}

export interface FocusSkill {
  skillId: string;
  name: string;
  cluster: string | null;
  level: number;
  proficiency: number;
  confidence: number;
  evidenceCount: number;
  recencyDays: number;
}

const XP_PER_KIND: Record<string, number> = {
  assessment: 40,
  outcome: 40,
  code: 15,
  behavioral: 10,
  document: 8,
  self: 3,
};

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboardKpis(userId: string): Promise<DashboardKpis> {
    const [skillsTracked, skillsCatalog, evidenceRows, factsVerified, factsTotal, repos] = await Promise.all([
      this.prisma.candidateSkillState.count({ where: { userId, evidenceCount: { gt: 0 } } }),
      this.prisma.skill.count(),
      this.prisma.evidence.count({ where: { userId } }),
      this.prisma.resumeFact.count({ where: { userId, verified: true } }),
      this.prisma.resumeFact.count({ where: { userId } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT ("sourceRef"->>'repoId'))::bigint AS count
        FROM evidence
        WHERE "userId" = ${userId}::uuid
          AND "sourceRef"->>'kind' = 'github_repo'
      `,
    ]);
    return {
      skillsTracked,
      skillsCatalog,
      evidenceRows,
      reposAnalyzed: Number(repos[0]?.count ?? 0),
      factsVerified,
      factsTotal,
    };
  }

  async levelSummary(userId: string, tzInput?: string): Promise<LevelSummary> {
    const tz = safeTz(tzInput);

    const [topSkills, streakRows, xpRows] = await Promise.all([
      this.prisma.candidateSkillState.findMany({
        where: { userId, evidenceCount: { gt: 0 } },
        select: { level: true },
        orderBy: { level: 'desc' },
        take: 10,
      }),
      // Bucket days in the user's timezone so evening work in PST doesn't slip into next-day UTC.
      // tz is whitelisted above, so parameter interpolation is safe.
      this.prisma.$queryRawUnsafe<Array<{ day: string }>>(
        `SELECT DISTINCT to_char("observedAt" AT TIME ZONE $1, 'YYYY-MM-DD') AS day
         FROM evidence
         WHERE "userId" = $2::uuid
         ORDER BY day DESC
         LIMIT 400`,
        tz,
        userId,
      ),
      this.prisma.$queryRaw<Array<{ kind: string; n: bigint }>>`
        SELECT kind, COUNT(*)::bigint AS n
        FROM evidence
        WHERE "userId" = ${userId}::uuid
        GROUP BY kind
      `,
    ]);

    const topLevel = topSkills[0]?.level ?? 1;
    const totalXp = xpRows.reduce((s, r) => s + Number(r.n) * (XP_PER_KIND[r.kind] ?? 5), 0);
    // overallLevel derived from XP so the frontend progress bar never disagrees.
    const overallLevel = levelFromXp(totalXp);

    // Streak: walk back in the user's local day boundary. Both "today" and each prior day
    // are formatted through the same tz, so a PST user logging at 22:00 local keeps their streak.
    const daySet = new Set(streakRows.map((r) => r.day));
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const cursor = new Date();
    let streak = 0;
    // If today's slot has evidence, count it and step back; otherwise skip today and start
    // from yesterday so an active daily streak isn't wiped at midnight before new work lands.
    if (daySet.has(fmt.format(cursor))) {
      streak = 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (daySet.has(fmt.format(cursor))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return { overallLevel, totalXp, streakDays: streak, topLevel, timezone: tz };
  }

  async recentEvidence(userId: string, limit = 5): Promise<RecentEvidenceRow[]> {
    const rows = await this.prisma.evidence.findMany({
      where: { userId },
      include: { skill: { select: { name: true } } },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((r) => {
      const src = r.sourceRef as Record<string, unknown> | null;
      return {
        id: r.id,
        skillId: r.skillId,
        skillName: r.skill.name,
        kind: r.kind,
        signal: r.signal,
        observedAt: r.observedAt.toISOString(),
        sourceKind: typeof src?.kind === 'string' ? (src.kind as string) : null,
      };
    });
  }

  /**
   * "Top" skills for the dashboard: rank by level desc, break ties by evidenceCount.
   * Once slice 6 lands market data, this will switch to `learning_priority`.
   */
  async topSkills(userId: string, limit = 3): Promise<FocusSkill[]> {
    const rows = await this.prisma.candidateSkillState.findMany({
      where: { userId, evidenceCount: { gt: 0 } },
      include: { skill: { select: { name: true, cluster: true } } },
      orderBy: [{ level: 'desc' }, { evidenceCount: 'desc' }],
      take: Math.min(Math.max(limit, 1), 20),
    });
    return rows.map((r) => ({
      skillId: r.skillId,
      name: r.skill.name,
      cluster: r.skill.cluster,
      level: r.level,
      proficiency: Number(r.proficiency),
      confidence: Number(r.confidence),
      evidenceCount: r.evidenceCount,
      recencyDays: r.recencyDays,
    }));
  }
}
