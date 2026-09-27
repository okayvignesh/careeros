-- One row per LLM call where the grounded-generation validator suspected a
-- hallucination (numbers/dates/companies in the output that were not in the
-- injected facts). Append-only; retention lands with slice 7.
CREATE TABLE "llm_hallucination_log" (
    "id"             UUID NOT NULL,
    "userId"         UUID,
    "llmCallId"      UUID,
    "promptId"       TEXT NOT NULL,
    "promptVersion"  TEXT NOT NULL,
    "promptHash"     TEXT NOT NULL,
    "suspectFragments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "detail"         JSONB,
    "timestamp"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_hallucination_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_hallucination_log_userId_timestamp_idx"
  ON "llm_hallucination_log" ("userId", "timestamp");
CREATE INDEX "llm_hallucination_log_promptId_timestamp_idx"
  ON "llm_hallucination_log" ("promptId", "timestamp");

ALTER TABLE "llm_hallucination_log"
  ADD CONSTRAINT "llm_hallucination_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "llm_hallucination_log"
  ADD CONSTRAINT "llm_hallucination_log_llmCallId_fkey"
  FOREIGN KEY ("llmCallId") REFERENCES "llm_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
