// Job ↔ candidate match scoring. Pure functions only — no DB, no LLM.
//
// This is the SINGLE match implementation. Both the jobs list (`GET /jobs`,
// via `computeMatchResult`) and the job detail (`POST /matcher/score`, via
// `computeMatch`) call it, so the same job/candidate pair can never surface two
// different scores. Moved verbatim out of apps/api matcher.service (C-P4.1) so
// the architecture matches AGENTS.md §12 (… relevance → match → land).
//
// ------ Formulas (single source of truth; keep in sync with tests) ------
//
//   user_prof(s)  = clamp(candidate_skill_state.proficiency / 100, 0..1)
//                   0 when the user has no state row for skill s.
//
//   weight(s)     = job.requiredSkills[s].weight, defaulting to 1.0.
//                   NormalizedJob today stores skillIds as string[] with no
//                   per-skill weight, so every required skill is weighted
//                   equally. When the extractor starts emitting weights,
//                   drop them into the requiredSkills map — no other change.
//
//   score         = Σ min(user_prof(s), 1) * weight(s)  /  Σ weight(s)
//                   over the job's required skills.
//                   0 when the job has no required skills yet (extraction
//                   hasn't run) or when the sum-of-weights is 0.
//
//   recency_factor(s) — bands on `recencyDays` from CandidateSkillState:
//                   d <= 90    -> 1.00
//                   d <= 180   -> 0.75
//                   otherwise  -> 0.50  (also when no state row exists,
//                                        but user_prof is 0 there so the
//                                        contribution vanishes anyway)
//
//   readiness     = Σ min(user_prof(s), 1) * weight(s) * recency_factor(s)
//                    / Σ weight(s)
//                   Always <= score. Equal to score only when every
//                   contributing skill is fresh (<=90d).
//
//   gap           = { skill: required skill s where user_prof(s) < 0.5,
//                     weight, currentProf, deltaNeeded = 0.5 - currentProf }
//
//   explanations  = { kind: 'strong' | 'weak' | 'missing', skill, evidence?, note }
//                   strong  -> user_prof >= 0.7, up to 2 recent evidence rows
//                   weak    -> 0 < user_prof < 0.5
//                   missing -> no state row, or user_prof == 0

const STRONG_PROF = 0.7;
const WEAK_PROF = 0.5;
const RECENCY_FRESH_DAYS = 90;
const RECENCY_STALE_DAYS = 180;
const RECENCY_FRESH = 1.0;
const RECENCY_MID = 0.75;
const RECENCY_OLD = 0.5;
const MAX_EVIDENCE_PER_STRONG = 2;

/**
 * Compact match shape returned with each row in the jobs list. Kept separate
 * from the rich `MatchScore` because the list renders only a score + coverage
 * summary, while the detail view renders gap + explanations + evidence.
 */
export interface MatchResult {
  /** null when the job has no extracted skills yet (can't compute). */
  score: number | null;
  /** How many required skills the candidate covers at/above the weak bar. */
  matched: number;
  /** How many skills the job asks for. */
  total: number;
  /** Required skills below the weak bar — sorted for stable UI. */
  missing: string[];
}

export interface GapItem {
  skillId: string;
  skillName: string;
  weight: number;
  currentProf: number;
  deltaNeeded: number;
}

export interface EvidenceRef {
  id: string;
  kind: string;
  signal: string;
  observedAt: string;
}

export interface Explanation {
  kind: 'strong' | 'weak' | 'missing';
  skillId: string;
  skillName: string;
  evidence?: EvidenceRef[];
  note: string;
}

export interface MatchScore {
  jobId: string;
  score: number;
  readiness: number;
  gap: GapItem[];
  explanations: Explanation[];
  computedAt: Date;
}

/** Per-skill weight; today always 1.0. Kept as a type so a future
 *  extractor emitting weights drops in without a call-site rewrite. */
export interface RequiredSkill {
  skillId: string;
  weight: number;
}

export interface ComputeInput {
  jobId: string;
  required: RequiredSkill[];
  nameById: Map<string, string>;
  stateBySkill: Map<
    string,
    { proficiency: unknown; recencyDays: number }
  >;
  evidenceBySkill: Map<
    string,
    Array<{ id: string; kind: string; signal: string; observedAt: Date }>
  >;
  now?: Date;
}

export function computeMatch(input: ComputeInput): MatchScore {
  const { jobId, required, nameById, stateBySkill, evidenceBySkill } = input;
  const now = input.now ?? new Date();

  if (required.length === 0) {
    return { jobId, score: 0, readiness: 0, gap: [], explanations: [], computedAt: now };
  }

  let sumCoverage = 0;
  let sumReadiness = 0;
  let sumWeights = 0;
  const gap: GapItem[] = [];
  const explanations: Explanation[] = [];

  for (const { skillId, weight } of required) {
    const w = clampUnit(weight);
    sumWeights += w;
    const state = stateBySkill.get(skillId);
    const prof = state ? clampUnit(Number(state.proficiency) / 100) : 0;
    const recency = state ? recencyFactor(state.recencyDays) : RECENCY_OLD;
    sumCoverage += prof * w;
    sumReadiness += prof * w * recency;

    const skillName = nameById.get(skillId) ?? skillId;

    if (!state || prof === 0) {
      gap.push({ skillId, skillName, weight: w, currentProf: 0, deltaNeeded: WEAK_PROF });
      explanations.push({
        kind: 'missing',
        skillId,
        skillName,
        note: `No evidence for ${skillName}; job weight ${w.toFixed(2)}.`,
      });
      continue;
    }

    if (prof < WEAK_PROF) {
      gap.push({
        skillId,
        skillName,
        weight: w,
        currentProf: prof,
        deltaNeeded: WEAK_PROF - prof,
      });
      explanations.push({
        kind: 'weak',
        skillId,
        skillName,
        note: `Proficiency ${prof.toFixed(2)} below bar (${WEAK_PROF.toFixed(2)}); +${(WEAK_PROF - prof).toFixed(2)} needed.`,
      });
      continue;
    }

    if (prof >= STRONG_PROF) {
      const ev = (evidenceBySkill.get(skillId) ?? [])
        .slice(0, MAX_EVIDENCE_PER_STRONG)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          signal: e.signal,
          observedAt: e.observedAt.toISOString(),
        }));
      const expl: Explanation = {
        kind: 'strong',
        skillId,
        skillName,
        note: `Strong: proficiency ${prof.toFixed(2)}, ${ev.length} recent evidence row(s).`,
      };
      if (ev.length > 0) expl.evidence = ev;
      explanations.push(expl);
      continue;
    }

    // Middle band: covered but below "strong". No gap, no note noise.
    explanations.push({
      kind: 'weak',
      skillId,
      skillName,
      note: `Covered at ${prof.toFixed(2)} (weight ${w.toFixed(2)}); short of strong.`,
    });
  }

  const score = sumWeights > 0 ? sumCoverage / sumWeights : 0;
  const readiness = sumWeights > 0 ? sumReadiness / sumWeights : 0;
  return {
    jobId,
    score: clampUnit(score),
    readiness: clampUnit(readiness),
    gap,
    explanations,
    computedAt: now,
  };
}

/**
 * Jobs-list projection over `computeMatch`: runs the canonical weighted scorer
 * and flattens it to the compact per-row shape. `score` is therefore identical
 * to the detail view's `score` for the same job + candidate state. Returns
 * `score: null` when the job has no extracted skills (old list behaviour —
 * a 0% score there would be misleading).
 */
export function computeMatchResult(input: ComputeInput): MatchResult {
  if (input.required.length === 0) {
    return { score: null, matched: 0, total: 0, missing: [] };
  }
  const score = computeMatch(input);
  const missing = score.gap.map((g) => g.skillId).sort();
  return {
    score: score.score,
    matched: input.required.length - missing.length,
    total: input.required.length,
    missing,
  };
}

function recencyFactor(recencyDays: number): number {
  // Aggregator uses -1 as "never seen"; treat as stale.
  if (recencyDays < 0) return RECENCY_OLD;
  if (recencyDays <= RECENCY_FRESH_DAYS) return RECENCY_FRESH;
  if (recencyDays <= RECENCY_STALE_DAYS) return RECENCY_MID;
  return RECENCY_OLD;
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
