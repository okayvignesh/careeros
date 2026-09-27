-- Follow-up to 20260923090000: the FK was created there but Prisma had no relation
-- field for `llmCallId`, so schema drift would surface on the next migrate. This
-- migration only adds the join index the model now declares. The FK constraint
-- itself already exists on the shipped table.
CREATE INDEX IF NOT EXISTS "llm_hallucination_log_llmCallId_idx"
  ON "llm_hallucination_log" ("llmCallId");
