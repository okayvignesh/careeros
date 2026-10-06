import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import { MarketDemandService } from '../market-demand/market-demand.service';
import {
  computeLearningPriority,
  readinessFactor,
  TARGET_ROLE_PROF,
  type LearningPriorityRow,
} from './learning-priority';
import { matchRoleFamily, resolveRoleSkills, skillsForFamily } from './role-skill-map';

/**
 * C-P1.2b (P2 scoped): orchestrator around the pure `computeLearningPriority`
 * formula. Pulls signals from Postgres + the prefs service, hands them to the
 * pure function, returns the sorted rows.
 *
 * P2 §8 changes:
 *   - market demand now comes from `MarketDemandService.demandBySkill`, so the
 *     pool is preference- AND geo-filtered exactly like the demand table. The
 *     old direct `normalizedJob` query (no filters at all) is gone.
 *   - target bars come from `aim_role_thresholds`; absent rows fall back to the
 *     `TARGET_ROLE_PROF` / `TARGET_DEFAULT_PROF` constants.
 *   - `current_readiness` (recency-adjusted) drives the gap; the never-decaying
 *     historical demonstrated proficiency is carried separately (AGENTS §11).
 *
 * Freshness window on the job pool matches B-10 verify stage (45 days).
 */
const DEMAND_WINDOW_DAYS = 45;

@Injectable()
export class LearningPriorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: JobPreferencesService,
    private readonly demand: MarketDemandService,
  ) {}

  async rankFor(userId: string): Promise<LearningPriorityRow[]> {
    const [states, marketDemandBySkill, evidenceRows, prefsDto, thresholdRows] =
      await Promise.all([
        this.prisma.candidateSkillState.findMany({
          where: { userId },
          select: { skillId: true, proficiency: true, recencyDays: true },
        }),
        // Scoped by the same prefs/geo rules as the demand table (P2 §8).
        this.demand.demandBySkill(userId, DEMAND_WINDOW_DAYS),
        // Group-by (userId, skillId) MAX(observedAt). No Prisma helper for
        // MAX-per-group without raw SQL; scan-then-max in memory is fine for
        // the < few-thousand rows a single user will accumulate.
        this.prisma.evidence.findMany({
          where: { userId },
          select: { skillId: true, observedAt: true },
        }),
        this.prefs.get(userId),
        // Per-user role bars. Empty is the common case → constant fallback.
        this.prisma.aimRoleThreshold.findMany({
          where: { userId },
          select: { roleKey: true, threshold: true },
        }),
      ]);

    // Proficiency is stored as 0..100. Historical demonstrated proficiency is
    // the raw value; current readiness decays with recency (AGENTS §11).
    const currentReadinessBySkill = new Map<string, number>();
    const historicalProficiencyBySkill = new Map<string, number>();
    for (const s of states) {
      const demonstrated = clamp01(Number(s.proficiency) / 100);
      historicalProficiencyBySkill.set(s.skillId, demonstrated);
      // `recencyDays` is undefined in some legacy fakes/rows; treat as fresh.
      const recencyDays = typeof s.recencyDays === 'number' ? s.recencyDays : 0;
      currentReadinessBySkill.set(s.skillId, clamp01(demonstrated * readinessFactor(recencyDays)));
    }

    const evidenceRecencyBySkill = new Map<string, Date>();
    for (const e of evidenceRows) {
      const prev = evidenceRecencyBySkill.get(e.skillId);
      if (!prev || e.observedAt > prev) {
        evidenceRecencyBySkill.set(e.skillId, e.observedAt);
      }
    }

    const targetRoleSkills = resolveRoleSkills(prefsDto.targetRoles ?? []);
    const roleThresholdBySkill = this.resolveRoleThresholds(
      prefsDto.targetRoles ?? [],
      thresholdRows,
    );

    return computeLearningPriority({
      userProficiencyBySkill: currentReadinessBySkill,
      historicalProficiencyBySkill,
      marketDemandBySkill,
      targetRoleSkills,
      roleThresholdBySkill,
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

  /**
   * Map persisted `aim_role_thresholds` rows onto the per-skill bar the pure
   * formula consumes. Unknown roles are ignored; when several target roles map
   * to one skill the most demanding bar wins. Any target role without a row
   * falls back to `TARGET_ROLE_PROF`, which preserves the pre-P2 behavior.
   */
  private resolveRoleThresholds(
    targetRoles: readonly string[],
    rows: Array<{ roleKey: string; threshold: unknown }>,
  ): Map<string, number> {
    const byRole = new Map<string, number>();
    for (const row of rows) {
      byRole.set(row.roleKey, clamp01(Number(row.threshold)));
    }
    const bySkill = new Map<string, number>();
    for (const role of targetRoles) {
      const family = matchRoleFamily(role);
      if (!family) continue;
      const threshold = byRole.get(family) ?? TARGET_ROLE_PROF;
      for (const skillId of skillsForFamily(family)) {
        const prev = bySkill.get(skillId);
        if (prev === undefined || threshold > prev) bySkill.set(skillId, threshold);
      }
    }
    return bySkill;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
