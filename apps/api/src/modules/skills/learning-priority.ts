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
//   target(s)         = 0.7 if s in targetRoleSkills, else 0.5
//   gap(s)            = clamp(target(s) - min(current(s), target(s)), 0..1)
//                       0 when current >= target.
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
  /** `Date` of most recent evidence per skill; missing = no evidence. */
  evidenceRecencyBySkill?: Map<string, Date>;
  /** Wall clock for recency deltas. Injected for determinism in tests. */
  now?: Date;
}

export interface LearningPriorityFactors {
  current: number;
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

const TARGET_ROLE_PROF = 0.7;
const TARGET_DEFAULT_PROF = 0.5;
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
    const current = clamp01(input.userProficiencyBySkill.get(skillId) ?? 0);
    const demandRaw = input.marketDemandBySkill.get(skillId) ?? 0;
    const demandNorm = maxDemand === 0 ? 0 : demandRaw / maxDemand;
    const isTargetRole = targetRoleSkills.has(skillId);
    const target = isTargetRole ? TARGET_ROLE_PROF : TARGET_DEFAULT_PROF;
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
      }),
      factors: {
        current,
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
