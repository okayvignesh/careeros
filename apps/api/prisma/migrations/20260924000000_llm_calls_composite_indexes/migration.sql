-- Composite indexes to keep Usage & Costs breakdown queries index-scannable
-- once llm_calls grows past a few thousand rows. The existing
-- (userId, timestamp DESC) and (userId, provider, model, timestamp DESC)
-- indexes already cover summary + provider/model paths.
--
-- ponytail: at personal-use scale these are near-free scans; kept for the day
-- someone runs this multi-user or over a long history.

CREATE INDEX IF NOT EXISTS "llm_calls_user_kind_ts_idx"
  ON "llm_calls" ("userId", "callKind", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "llm_calls_user_model_ts_idx"
  ON "llm_calls" ("userId", "model", "timestamp" DESC);
