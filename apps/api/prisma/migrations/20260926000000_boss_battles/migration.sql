-- Boss battles: milestone-triggered timed challenges. Server-authoritative
-- timer via startedAt + durationS. A user may retry a milestone after failing
-- or letting the timer expire, but can only pass a given milestone once —
-- enforced by the partial-unique index below.

CREATE TABLE "boss_battles" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"      UUID           NOT NULL,
    "milestone"   INT            NOT NULL,
    "startedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationS"   INT            NOT NULL DEFAULT 1800,
    "submittedAt" TIMESTAMPTZ(6),
    "score"       DECIMAL(4, 3),
    "status"      TEXT           NOT NULL DEFAULT 'active',
    "questionIds" TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "attemptIds"  TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "boss_battles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "boss_battles_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

-- One PASSED boss per (user, milestone). Failed/expired/active rows can stack.
CREATE UNIQUE INDEX "boss_battles_passed_uniq"
    ON "boss_battles" ("userId", "milestone")
    WHERE status = 'passed';

-- One ACTIVE boss per user at a time (across all milestones). Prevents parallel runs.
CREATE UNIQUE INDEX "boss_battles_active_uniq"
    ON "boss_battles" ("userId")
    WHERE status = 'active';

CREATE INDEX "boss_battles_user_status_idx"
    ON "boss_battles" ("userId", "status");
