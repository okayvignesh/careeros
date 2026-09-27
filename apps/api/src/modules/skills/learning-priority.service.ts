import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import {
  computeLearningPriority,
  type LearningPriorityRow,
} from './learning-priority';
import { resolveRoleSkills } from './role-skill-map';

/**
 * C-P1.2b: orchestrator around the pure `computeLearningPriority` formula.
 * Pulls three signals from Postgres + one from the prefs service, hands
 * them to the pure function, returns the sorted rows.
 *
 * Freshness window on the job pool matches B-10 verify stage (45 days).
 * No caching -- three Prisma reads on the "give me my learning list" page
 * are cheap enough at MVP scale (< 200 skills, < 5000 jobs). Add a Redis
 * key `learning-priority:${userId}` with a 60s TTL if the endpoint shows
 * up on the hot path.
 */
const DEMAND_WINDOW_DAYS = 45;
const DAY_MS = 86_400_000;

@Injectable()
export class LearningPriorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: JobPreferencesService,
  ) {}

  async rankFor(userId: string): Promise<LearningPriorityRow[]> {
    const cutoff = new Date(Date.now() - DEMAND_WINDOW_DAYS * DAY_MS);

    const [states, jobs, evidenceRows, prefsDto] = await Promise.all([
      this.prisma.candidateSkillState.findMany({
        where: { userId },
        select: { skillId: true, proficiency: true },
      }),
      // Freshness gate matches B-10 verify stage. Only skillIds are needed
      // for the demand histogram, so the select is minimal.
      this.prisma.normalizedJob.findMany({
        where: {
          OR: [
            { sourcePostedAt: { gte: cutoff } },
            { sourcePostedAt: null, firstSeenAt: { gte: cutoff } },
          ],
        },
        select: { skillIds: true },
      }),
      // Group-by (userId, skillId) MAX(observedAt). No Prisma helper for
      // MAX-per-group without raw SQL; scan-then-max in memory is fine
      // for the < few-thousand rows a single user will accumulate. Upgrade
      // to `SELECT skill_id, max(observed_at) ... GROUP BY skill_id` if a
      // user's evidence table crosses ~50k rows.
      this.prisma.evidence.findMany({
        where: { userId },
        select: { skillId: true, observedAt: true },
      }),
      this.prefs.get(userId),
    ]);

    // Proficiency stored as 0..100 Decimal; the pure formula speaks 0..1.
    const userProficiencyBySkill = new Map<string, number>();
    for (const s of states) {
      userProficiencyBySkill.set(s.skillId, Number(s.proficiency) / 100);
    }

    const marketDemandBySkill = new Map<string, number>();
    for (const j of jobs) {
      for (const id of j.skillIds) {
        marketDemandBySkill.set(id, (marketDemandBySkill.get(id) ?? 0) + 1);
      }
    }

    const evidenceRecencyBySkill = new Map<string, Date>();
    for (const e of evidenceRows) {
      const prev = evidenceRecencyBySkill.get(e.skillId);
      if (!prev || e.observedAt > prev) {
        evidenceRecencyBySkill.set(e.skillId, e.observedAt);
      }
    }

    const targetRoleSkills = resolveRoleSkills(prefsDto.targetRoles ?? []);

    return computeLearningPriority({
      userProficiencyBySkill,
      marketDemandBySkill,
      targetRoleSkills,
      evidenceRecencyBySkill,
    });
  }

  async detailFor(userId: string, skillId: string): Promise<LearningPriorityRow> {
    const all = await this.rankFor(userId);
    const hit = all.find((r) => r.skillId === skillId);
    if (!hit) {
      throw new NotFoundException(
        `Skill '${skillId}' has no priority row (no demand, no proficiency, not in target role)`,
      );
    }
    return hit;
  }
}
