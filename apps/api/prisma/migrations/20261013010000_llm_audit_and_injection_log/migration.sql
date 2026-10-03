-- ai-safety.md items 9 (LLM call audit + token accounting) and 5 (injection log).
--
-- (9) Extend the append-only `llm_calls` ledger with the prompt-registry
-- identity, sensitivity class, pre-flight token estimate, input/output cost
-- split + pricing version, structured-validation verdict, and cache flag so the
-- Usage & Costs dashboard can break down by prompt/sensitivity and a post-hoc
-- review can reconstruct what the model was asked. All columns are nullable or
-- defaulted, so existing rows stay valid and no backfill is needed.
ALTER TABLE "llm_calls" ADD COLUMN "promptId" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "promptHash" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "sensitivity" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "agentRole" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "estimatedPromptTokens" INTEGER;
ALTER TABLE "llm_calls" ADD COLUMN "costInput" DECIMAL(10,6);
ALTER TABLE "llm_calls" ADD COLUMN "costOutput" DECIMAL(10,6);
ALTER TABLE "llm_calls" ADD COLUMN "pricingVersion" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "validation" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN "cacheHit" BOOLEAN NOT NULL DEFAULT false;

-- Aggregation support for the dashboard's by-prompt / by-sensitivity views.
CREATE INDEX "llm_calls_promptId_timestamp_idx" ON "llm_calls"("promptId", "timestamp");
CREATE INDEX "llm_calls_sensitivity_timestamp_idx" ON "llm_calls"("sensitivity", "timestamp");

-- (5) Dedicated injection audit trail. One row per suspect/blocked flag at the
-- wrap/scan boundary. `snippet` is encrypted at rest by the Prisma extension
-- (ENCRYPTED_FIELDS: LlmInjectionLog.snippet); `snippetHash` + `snippetOffset`
-- stay cleartext so the audit UI can locate the fragment without decrypting.
CREATE TABLE "llm_injection_log" (
    "id"            UUID NOT NULL,
    "userId"        UUID,
    "llmCallId"     UUID,
    "sourceKind"    TEXT NOT NULL,
    "promptId"      TEXT,
    "severity"      TEXT NOT NULL,
    "score"         REAL,
    "action"        TEXT NOT NULL,
    "hits"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "snippet"       TEXT,
    "snippetHash"   TEXT,
    "snippetOffset" JSONB,
    "timestamp"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_injection_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_injection_log_userId_timestamp_idx"
  ON "llm_injection_log" ("userId", "timestamp");
CREATE INDEX "llm_injection_log_sourceKind_timestamp_idx"
  ON "llm_injection_log" ("sourceKind", "timestamp");
CREATE INDEX "llm_injection_log_severity_timestamp_idx"
  ON "llm_injection_log" ("severity", "timestamp");

ALTER TABLE "llm_injection_log"
  ADD CONSTRAINT "llm_injection_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "llm_injection_log"
  ADD CONSTRAINT "llm_injection_log_llmCallId_fkey"
  FOREIGN KEY ("llmCallId") REFERENCES "llm_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
