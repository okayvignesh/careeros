// C-P1.2a: `learning_priority` pure formula. Deterministic ranking of which
// skills the user should learn NEXT, blending three signals:
//
//   1. market demand   -- how often each skill appears in fresh (<=45d) jobs
//   2. gap vs target   -- how far current proficiency is from a target level
//                         (0.7 for target-role skills, 0.5 otherwise)
//   3. evidence recency -- freshness of the last evidence for the skill;
//                        stale skills are lightly deprioritised so ties
//                        break toward the truly-open gaps
//
// ------ Formula ------
//
//   demand_norm(s)    = demand(s) / max(demand)          in [0..1]
//                       0 when max(demand) == 0 (nothing scraped yet).
//
//   target(s)         = roleThresholdBySkill(s) when the user has an
//                       `aim_role_thresholds` row for a target role mapping to
//                       s, else 0.7 if s in targetRoleSkills, else 0.5.
//   gap(s)            = clamp(target(s) - min(current(s), target(s)), 0..1)
//                       0 when current >= target.
//                       `current` is current_readiness (recency-adjusted);
//                       historical_demonstrated_proficiency is tracked
//                       separately in `factors.historical` and never feeds the
//                       gap (AGENTS §11).
//                       Uses `min(current, target)` so surplus above target
//                       doesn't push gap negative -- the goal is "reach the
//                       bar", not "beat it".
//
//   recency_penalty(s) = 1.0  if last evidence <  90d
//                        0.7  if last evidence <  180d
//                        0.4  otherwise (incl. no evidence at all)
//
//   role_boost(s)      = 1.3 if s in targetRoleSkills, else 1.0
//
//   priority(s) = clamp(
//     ((0.4 * demand_norm) + (0.5 * gap) + (0.1 * recency_penalty))
//     * role_boost,
//     0..1
//   )
//
// The weights (0.4 / 0.5 / 0.1) put gap over demand, which is the honest
// signal: high-demand skills the user already has aren't priorities.
// Recency is a tiebreaker, not a driver.
//
// Everything below is pure -- no io, no dates parsed from strings, no
// module-level state. `now` is passed in so tests are fully deterministic.

export interface LearningPriorityInput {
  /** Current proficiency per skill, on the same 0..1 scale the aggregator
   *  emits after dividing CandidateSkillState.proficiency (0..100) by 100.
   *  Missing skill = 0 (never touched). */
  userProficiencyBySkill: Map<string, number>;
  /** Raw count of skill mentions across the fresh-job pool. */
  marketDemandBySkill: Map<string, number>;
  /** Skill IDs the user's targetRoles map onto (via role-skill-map.ts). */
  targetRoleSkills?: Set<string>;
  /**
   * Per-skill target bar resolved from `aim_role_thresholds` (roleKey →
   * threshold) by the orchestrator. Absent skill IDs fall back to
   * `TARGET_ROLE_PROF` for target-role skills and `TARGET_DEFAULT_PROF`
   * otherwise, so the legacy `0.5/0.7` behaviour is preserved for users with
   * no explicit threshold rows.
   */
  roleThresholdBySkill?: Map<string, number>;
  /**
   * Never-decaying demonstrated proficiency per skill (0..1). Kept distinct
   * from `userProficiencyBySkill` (current readiness) per AGENTS §11; defaults
   * to the current value when absent so legacy callers are unchanged.
   */
  historicalProficiencyBySkill?: Map<string, number>;
  /** `Date` of most recent evidence per skill; missing = no evidence. */
  evidenceRecencyBySkill?: Map<string, Date>;
  /** Wall clock for recency deltas. Injected for determinism in tests. */
  now?: Date;
}

export interface LearningPriorityFactors {
  /** Recency-adjusted readiness used for gap math (AGENTS §11 current_readiness). */
  current: number;
  /** Best-ever demonstrated proficiency (AGENTS §11 historical_demonstrated_proficiency). */
  historical: number;
  demand: number;
  gap: number;
  recency: number;
  targetRole: boolean;
}

export interface LearningPriorityRow {
  skillId: string;
  priority: number; // [0..1]
  reasons: string[];
  factors: LearningPriorityFactors;
}

export const TARGET_ROLE_PROF = 0.7;
export const TARGET_DEFAULT_PROF = 0.5;
const RECENCY_FRESH_DAYS = 90;
const RECENCY_MID_DAYS = 180;
const RECENCY_FRESH = 1.0;
const RECENCY_MID = 0.7;
const RECENCY_OLD = 0.4;
const ROLE_BOOST = 1.3;
const WEIGHT_DEMAND = 0.4;
const WEIGHT_GAP = 0.5;
const WEIGHT_RECENCY = 0.1;
const DAY_MS = 86_400_000;

// Reason thresholds. These only govern the human-readable strings; the
// numeric priority is unaffected.
const HIGH_DEMAND_NORM = 0.6;
const LARGE_GAP = 0.4;
/** Readiness below demonstrated by at least this much is surfaced as decay. */
const READINESS_DECAY = 0.2;

/**
 * Rank the union of skills present in either `userProficiencyBySkill` or
 * `marketDemandBySkill`. Skills the user has zero proficiency in AND zero
 * demand for still appear if they're in `targetRoleSkills` -- the role
 * itself asserts they matter.
 *
 * Returns rows sorted by `priority` desc, then `skillId` asc for stability
 * on ties (matters for the "top N" UI + snapshot tests).
 */
export function computeLearningPriority(
  input: LearningPriorityInput,
): LearningPriorityRow[] {
  const now = input.now ?? new Date();
  const targetRoleSkills = input.targetRoleSkills ?? new Set<string>();
  const recency = input.evidenceRecencyBySkill ?? new Map<string, Date>();

  // Universe = skills the user has any proficiency in ∪ demand ∪ target-role.
  const allSkills = new Set<string>();
  for (const id of input.userProficiencyBySkill.keys()) allSkills.add(id);
  for (const id of input.marketDemandBySkill.keys()) allSkills.add(id);
  for (const id of targetRoleSkills) allSkills.add(id);

  // Global max used to normalise demand into [0..1]. If nothing has been
  // scraped, demand_norm is 0 for every row and priority is driven by gap
  // + role_boost alone -- the honest degenerate case.
  let maxDemand = 0;
  for (const d of input.marketDemandBySkill.values()) {
    if (d > maxDemand) maxDemand = d;
  }

  const rows: LearningPriorityRow[] = [];
  for (const skillId of allSkills) {
    // `current` is current_readiness (recency-adjusted, supplied already
    // decayed by the orchestrator); `historical` is the never-decaying
    // demonstrated proficiency. Gap math uses readiness, never history.
    const current = clamp01(input.userProficiencyBySkill.get(skillId) ?? 0);
    const historical = clamp01(input.historicalProficiencyBySkill?.get(skillId) ?? current);
    const demandRaw = input.marketDemandBySkill.get(skillId) ?? 0;
    const demandNorm = maxDemand === 0 ? 0 : demandRaw / maxDemand;
    const isTargetRole = targetRoleSkills.has(skillId);
    // An explicit `aim_role_thresholds` row wins; otherwise the shipped
    // 0.7 (target role) / 0.5 (default) fallback applies.
    const targetOverride = input.roleThresholdBySkill?.get(skillId);
    const target = clamp01(targetOverride ?? (isTargetRole ? TARGET_ROLE_PROF : TARGET_DEFAULT_PROF));
    const gap = clamp01(target - Math.min(current, target));
    const recencyPenalty = recencyBand(recency.get(skillId), now);
    const roleBoost = isTargetRole ? ROLE_BOOST : 1.0;

    const raw =
      (WEIGHT_DEMAND * demandNorm +
        WEIGHT_GAP * gap +
        WEIGHT_RECENCY * recencyPenalty) *
      roleBoost;
    const priority = clamp01(raw);

    rows.push({
      skillId,
      priority,
      reasons: buildReasons({
        demandNorm,
        gap,
        target,
        recencyPenalty,
        hasEvidence: recency.has(skillId),
        isTargetRole,
        current,
        historical,
      }),
      factors: {
        current,
        historical,
        demand: demandNorm,
        gap,
        recency: recencyPenalty,
        targetRole: isTargetRole,
      },
    });
  }

  rows.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0;
  });
  return rows;
}

/**
 * Recency factor applied to demonstrated proficiency to derive current
 * readiness. Mirrors `match.ts` recency bands (fresh <=90d, mid <=180d, else
 * stale; `recencyDays < 0` means "never seen"). Exported so the orchestrator
 * and its tests share one definition.
 */
export function readinessFactor(recencyDays: number): number {
  if (recencyDays < 0) return 0.5;
  if (recencyDays <= RECENCY_FRESH_DAYS) return 1.0;
  if (recencyDays <= RECENCY_MID_DAYS) return 0.75;
  return 0.5;
}

function recencyBand(last: Date | undefined, now: Date): number {
  if (!last) return RECENCY_OLD;
  const ageDays = (now.getTime() - last.getTime()) / DAY_MS;
  if (ageDays < RECENCY_FRESH_DAYS) return RECENCY_FRESH;
  if (ageDays < RECENCY_MID_DAYS) return RECENCY_MID;
  return RECENCY_OLD;
}

function buildReasons(x: {
  demandNorm: number;
  gap: number;
  target: number;
  recencyPenalty: number;
  hasEvidence: boolean;
  isTargetRole: boolean;
  current: number;
  historical: number;
}): string[] {
  const out: string[] = [];
  if (x.isTargetRole) out.push('required by your target role');
  if (x.demandNorm >= HIGH_DEMAND_NORM) out.push('high market demand');
  else if (x.demandNorm > 0) out.push('some market demand');
  if (x.gap >= LARGE_GAP) {
    out.push(`large gap vs target ${x.target.toFixed(1)}`);
  } else if (x.gap > 0) {
    out.push(`small gap vs target ${x.target.toFixed(1)}`);
  } else if (x.current > 0) {
    out.push('already at or above target');
  }
  if (x.historical - x.current >= READINESS_DECAY) {
    out.push(`readiness decayed from demonstrated ${x.historical.toFixed(2)}`);
  }
  if (!x.hasEvidence) {
    out.push('no recent evidence');
  } else if (x.recencyPenalty === RECENCY_MID) {
    out.push('evidence older than 90 days');
  } else if (x.recencyPenalty === RECENCY_OLD) {
    out.push('evidence older than 180 days');
  }
  return out;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
