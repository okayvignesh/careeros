-- Aggregation-friendly indexes for the Usage & Costs dashboard.
-- Ordered by timestamp DESC because every dashboard query is "recent first" scoped to a user.
CREATE INDEX IF NOT EXISTS "llm_calls_user_ts_desc_idx"
  ON "llm_calls" ("userId", "timestamp" DESC);

-- Provider + model breakdowns share this composite.
CREATE INDEX IF NOT EXISTS "llm_calls_user_provider_model_ts_idx"
  ON "llm_calls" ("userId", "provider", "model", "timestamp" DESC);
