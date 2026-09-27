import { Injectable } from '@nestjs/common';
import { LearningPriorityService } from '../skills/learning-priority.service';
import type { LearningPriorityRow } from '../skills/learning-priority';
import {
  getPrereqs,
  getUnmetPrereqs,
  topoSortForLearning,
  type SkillId,
} from './prereq-graph';

/**
 * C-P2.6b: quest generator.
 *
 * Given a user, produce a small ordered list of learning tasks that respects
 * the hand-curated prereq DAG AND the C-P1.2 learning-priority ranking.
 *
 * Flow:
 *   1. `LearningPriorityService.rankFor(userId)` -> ranked skills.
 *   2. Split ranked skills into "mastered" (proficiency >= MASTERED_PROF)
 *      vs "priority frontier" (top slice we might plan for).
 *   3. For each priority skill, collect unmet prereqs recursively and add
 *      them to a "targets" set. Prereqs get their own quests, marked
 *      `unlock-prereq`, so the UI can label them.
 *   4. topoSort the targets, then rebuild a Quest per skill in learning order.
 *   5. Trim to `maxItems` (horizon-defaulted).
 *
 * All pure once the ranking is in hand -- no LLM, no async fan-out.
 */

const MASTERED_PROF = 0.7;
const RANK_TOP_SLICE = 8; // top N priorities we plan for before expanding prereqs
const HORIZON_CAPS: Record<Horizon, number> = {
  week: 5,
  month: 12,
  quarter: 25,
};

export type Horizon = 'week' | 'month' | 'quarter';

export type QuestKind =
  | 'unlock-prereq'
  | 'sharpen-existing'
  | 'reach-target';

export interface Quest {
  id: string; // stable-per-plan: `${kind}:${skillId}`
  skillId: SkillId;
  kind: QuestKind;
  priority: number; // [0..1], inherited from LearningPriority row when available
  reason: string;
  targetProficiency: number; // [0..1]
  estimatedHours: number;
}

export interface PlanOptions {
  targetHorizon?: Horizon;
  maxItems?: number;
}

/**
 * Estimated hours to reach the target proficiency for a skill. Numbers are
 * intentionally conservative-defaults sourced from field lore + course
 * catalogs (React ~30h to a working PR, Kubernetes ~60h to a first prod
 * deploy). Unknown skills fall back to DEFAULT_HOURS.
 *
 * ponytail: static table, refine when telemetry shows quest completions
 * consistently over/undershoot the estimate.
 */
export const HOURS_TABLE: Record<SkillId, number> = {
  // Languages
  js: 40,
  ts: 20,
  python: 40,
  go: 30,
  rust: 60,
  java: 45,
  kotlin: 25,
  swift: 30,
  csharp: 40,
  ruby: 30,
  php: 30,
  scala: 40,
  cpp: 60,
  sql: 25,
  bash: 15,
  html: 10,
  css: 20,
  // Frontend
  react: 30,
  vue: 25,
  angular: 35,
  nextjs: 20,
  svelte: 20,
  redux: 15,
  tailwind: 10,
  // Backend
  nodejs: 25,
  express: 15,
  nestjs: 25,
  django: 30,
  flask: 15,
  fastapi: 20,
  spring: 40,
  rails: 30,
  'rest-api': 15,
  graphql: 20,
  grpc: 20,
  // Data
  postgres: 25,
  mysql: 20,
  mongodb: 20,
  redis: 15,
  elasticsearch: 25,
  kafka: 35,
  airflow: 30,
  spark: 40,
  // Cloud
  aws: 50,
  gcp: 45,
  azure: 45,
  docker: 25,
  kubernetes: 60,
  terraform: 30,
  helm: 20,
  // Devops
  linux: 40,
  git: 15,
  'ci-cd': 20,
  'github-actions': 15,
  observability: 25,
  prometheus: 20,
  grafana: 15,
  sre: 60,
  // ML
  ml: 80,
  'deep-learning': 80,
  nlp: 60,
  llm: 40,
  pytorch: 50,
  tensorflow: 50,
  // Concepts
  'system-design': 60,
  'distributed-systems': 60,
  concurrency: 30,
  security: 40,
  algorithms: 60,
  'data-structures': 40,
  microservices: 30,
};

const DEFAULT_HOURS = 20;

@Injectable()
export class QuestGeneratorService {
  constructor(private readonly priorities: LearningPriorityService) {}

  async plan(userId: string, opts: PlanOptions = {}): Promise<Quest[]> {
    const horizon: Horizon = opts.targetHorizon ?? 'week';
    const cap = opts.maxItems ?? HORIZON_CAPS[horizon];

    const ranked = await this.priorities.rankFor(userId);
    return buildPlan(ranked, cap);
  }
}

/**
 * Pure planner. Exported so the service and the test both call the same
 * function; the service is only responsible for the IO fetch.
 */
export function buildPlan(
  ranked: LearningPriorityRow[],
  maxItems: number,
): Quest[] {
  // 1. What the user already owns (>= MASTERED_PROF is "we do not need to teach it").
  const mastered = new Set<SkillId>();
  for (const row of ranked) {
    if (row.factors.current >= MASTERED_PROF) mastered.add(row.skillId);
  }

  // 2. Top slice of the ranking becomes the initial target set.
  const topTargets = ranked
    .filter((r) => !mastered.has(r.skillId))
    .slice(0, RANK_TOP_SLICE);

  // 3. For each top target, walk unmet prereqs recursively -> full frontier.
  const frontier = new Set<SkillId>();
  const priorityBySkill = new Map<SkillId, number>();
  const reasonsBySkill = new Map<SkillId, string[]>();

  const addWithPrereqs = (skillId: SkillId, seedPriority: number, seedReasons: string[]): void => {
    if (mastered.has(skillId) || frontier.has(skillId)) return;
    frontier.add(skillId);
    priorityBySkill.set(skillId, seedPriority);
    reasonsBySkill.set(skillId, seedReasons);
    for (const p of getUnmetPrereqs(skillId, mastered)) {
      // Prereqs inherit a slightly-lower priority so the topo order dominates
      // ties. The reason string names *why* we're unlocking this.
      addWithPrereqs(
        p,
        seedPriority * 0.9,
        [`prerequisite for ${skillId}`],
      );
    }
  };

  for (const row of topTargets) {
    addWithPrereqs(row.skillId, row.priority, row.reasons);
  }

  // 4. Legal learning order.
  const order = topoSortForLearning(frontier, mastered);

  // 5. Materialise Quest rows in learning order.
  const rankedIdx = new Map<SkillId, LearningPriorityRow>();
  for (const r of ranked) rankedIdx.set(r.skillId, r);

  const quests: Quest[] = [];
  for (const skillId of order) {
    const seedRow = rankedIdx.get(skillId);
    const current = seedRow?.factors.current ?? 0;
    const isTopTarget = topTargets.some((t) => t.skillId === skillId);
    const kind: QuestKind = !isTopTarget
      ? 'unlock-prereq'
      : current > 0
        ? 'sharpen-existing'
        : 'reach-target';

    const target =
      seedRow?.factors.targetRole === true ? 0.7 : 0.5;

    const priority = priorityBySkill.get(skillId) ?? seedRow?.priority ?? 0;
    const reasons =
      reasonsBySkill.get(skillId) ?? seedRow?.reasons ?? ['ranked in your top priorities'];
    const reason = reasons.length > 0 ? reasons.join('; ') : 'ranked in your top priorities';

    quests.push({
      id: `${kind}:${skillId}`,
      skillId,
      kind,
      priority,
      reason,
      targetProficiency: target,
      estimatedHours: HOURS_TABLE[skillId] ?? DEFAULT_HOURS,
    });
  }

  // 6. Trim. Prereqs sort first (they must, by topo order), so the head of
  //    the plan is always "unlock-prereq" quests when relevant.
  return quests.slice(0, maxItems);
}
