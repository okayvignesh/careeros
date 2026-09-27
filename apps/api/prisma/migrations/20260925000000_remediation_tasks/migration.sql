-- Repeated-failure remediation tasks. Opened by the aggregator when a user
-- fails a skill 3+ times in the recent window; closed either by the user or by
-- a subsequent passing attempt on that skill (auto-close in the service).

CREATE TABLE "remediation_tasks" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"           UUID           NOT NULL,
    "skillId"          TEXT           NOT NULL,
    "reason"           TEXT           NOT NULL,
    "status"           TEXT           NOT NULL DEFAULT 'open',
    "sourceAttemptIds" TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"         TIMESTAMPTZ(6),

    CONSTRAINT "remediation_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "remediation_tasks_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

-- One OPEN task per (user, skill). Multiple closed rows are fine.
CREATE UNIQUE INDEX "remediation_tasks_open_uniq"
    ON "remediation_tasks" ("userId", "skillId")
    WHERE status = 'open';

CREATE INDEX "remediation_tasks_user_status_idx"
    ON "remediation_tasks" ("userId", "status");
