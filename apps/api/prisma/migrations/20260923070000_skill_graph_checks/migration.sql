-- DB-level trust boundary for skill graph tables. Runtime code clamps, but bad
-- inserts from LLM outputs or admin scripts must not silently poison aggregations.

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_weightHint_range"
  CHECK ("weightHint" IS NULL OR ("weightHint" >= 0 AND "weightHint" <= 1));

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_proficiency_range"
  CHECK ("proficiency" >= 0 AND "proficiency" <= 100);

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_confidence_range"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_level_range"
  CHECK ("level" >= 1 AND "level" <= 100);

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_evidence_count_nonneg"
  CHECK ("evidenceCount" >= 0);

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_recency_days_nonneg"
  CHECK ("recencyDays" >= 0);
