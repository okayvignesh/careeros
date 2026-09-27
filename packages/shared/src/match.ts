// Job ↔ candidate match scoring. Pure functions only — no DB, no LLM.
// Walking-skeleton (slice 15): "does the user have the skills this job asks for?"
// Weighted-by-proficiency and confidence-adjusted variants land when the
// dashboard needs `learning_priority` and `role_gap` per blueprint §5.4.

export interface MatchResult {
  /** null when the job has no extracted skills yet (can't compute). */
  score: number | null;
  /** How many job-required skills the user has evidence for. */
  matched: number;
  /** How many skills the job asks for. */
  total: number;
  /** Skills the user is missing for this role — sorted for stable UI. */
  missing: string[];
}

/**
 * Simple coverage score: `matched / total` over the job's requirements.
 * Returns `null` when the job's `jobSkillIds` is empty — that means either
 * extraction hasn't run yet or the LLM didn't match anything from our
 * catalogue, and either way a `0%` score would be misleading.
 *
 * Not symmetric: a user with 100 skills who covers all 3 the job asks for
 * scores 100%. That's intentional — jobs care whether their requirements
 * are met, not whether the candidate has extra breadth.
 */
export function matchScoreForJob(userSkillIds: readonly string[], jobSkillIds: readonly string[]): MatchResult {
  const total = jobSkillIds.length;
  if (total === 0) return { score: null, matched: 0, total: 0, missing: [] };
  const userSet = new Set(userSkillIds);
  const matchedList = jobSkillIds.filter((id) => userSet.has(id));
  const missing = jobSkillIds.filter((id) => !userSet.has(id)).sort();
  return {
    score: matchedList.length / total,
    matched: matchedList.length,
    total,
    missing,
  };
}
