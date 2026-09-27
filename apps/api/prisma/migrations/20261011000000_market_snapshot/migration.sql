-- C-P3.4: weekly market snapshots. Persist a stats row per (user x filterHash)
-- so week-over-week diffs (SnapshotService.diffAgainstLastWeek) can compute
-- deltas without recomputing history. Same statsJson shape as market_briefs;
-- kept in a dedicated table so the on-demand MarketBrief timeline stays clean.

CREATE TABLE "market_snapshots" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"      UUID,
    "snapshotAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filterHash"  TEXT           NOT NULL,
    "statsJson"   JSONB          NOT NULL,
    "createdBy"   TEXT           NOT NULL DEFAULT 'cron',

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "market_snapshots_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "market_snapshots_user_snapshotAt_idx"
    ON "market_snapshots" ("userId", "snapshotAt" DESC);

CREATE INDEX "market_snapshots_filterHash_snapshotAt_idx"
    ON "market_snapshots" ("filterHash", "snapshotAt" DESC);

-- Unique on (snapshotAt as UTC date, filterHash, userId-or-null-sentinel).
-- Postgres treats NULL as distinct in unique constraints, so coalesce the
-- userId to a sentinel UUID so the shared-default rows dedupe too. Prisma
-- can't express this in the DSL - lives here in the migration.
--
-- backlog:#80 fix: `date_trunc('day', <timestamptz>)` is STABLE, not
-- IMMUTABLE (return depends on the session TZ), so pg 15+ rejects it in a
-- unique index. Cast to date at UTC instead - that's IMMUTABLE and it's the
-- semantic we actually want ("one snapshot per UTC calendar day").
CREATE UNIQUE INDEX "market_snapshots_day_filter_user_key"
    ON "market_snapshots" (
        (("snapshotAt" AT TIME ZONE 'UTC')::date),
        "filterHash",
        COALESCE("userId", '00000000-0000-0000-0000-000000000000'::uuid)
    );
