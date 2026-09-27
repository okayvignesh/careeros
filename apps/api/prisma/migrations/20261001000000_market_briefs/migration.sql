-- Per-user weekly market briefs. Generated on demand from stats over the
-- user's preference-filtered job pool. Content is LLM prose grounded in the
-- stats + sources list stashed as JSON.

CREATE TABLE "market_briefs" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "generatedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart"  TIMESTAMPTZ(6) NOT NULL,
    "windowEnd"    TIMESTAMPTZ(6) NOT NULL,
    "statsJson"    JSONB          NOT NULL,
    "content"      TEXT           NOT NULL,
    "sourcesJson"  JSONB          NOT NULL,

    CONSTRAINT "market_briefs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "market_briefs_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "market_briefs_user_generatedAt_idx"
    ON "market_briefs" ("userId", "generatedAt" DESC);
