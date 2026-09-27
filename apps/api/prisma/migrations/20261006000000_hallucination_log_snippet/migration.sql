-- A-M4: hallucination log leak fix.
--   snippet        — raw source excerpt (encrypted at rest by PrismaService
--                    middleware; column always contains `enc:v1:snippet:...`
--                    ciphertext once the write path is live).
--   snippetHash    — sha256 hex of the *original* source text (not the excerpt).
--                    Low-privilege identifier for eval-only comparisons.
--   snippetOffset  — {start, end} byte offsets pointing at the excerpt in the
--                    source. Combined with snippetHash this lets an eval loop
--                    tell "same source, same fragment" without ever decrypting
--                    the row.
-- Retention: 30 days, enforced by the `hallucination-log-retention` worker.

ALTER TABLE "llm_hallucination_log"
  ADD COLUMN "snippet"       TEXT,
  ADD COLUMN "snippetHash"   TEXT,
  ADD COLUMN "snippetOffset" JSONB;

CREATE INDEX "llm_hallucination_log_snippetHash_idx"
  ON "llm_hallucination_log" ("snippetHash");
