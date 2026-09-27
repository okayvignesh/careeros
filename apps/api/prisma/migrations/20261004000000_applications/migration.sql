-- Application tracker (walking-skeleton). Two tables:
--   applications        — one row per (user, job) with current state
--   application_events  — append-only transition log (also captures create)
--
-- State machine is enforced in code (canTransition in packages/shared);
-- DB stores whatever the code wrote. Unique (userId, jobId) prevents dup rows
-- so `create` is naturally idempotent (P2002 → return existing).

CREATE TABLE "applications" (
    "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"          UUID           NOT NULL,
    "jobId"           UUID           NOT NULL,
    "state"           TEXT           NOT NULL DEFAULT 'interested',
    "appliedAt"       TIMESTAMPTZ(6),
    "resumeVariantId" UUID,
    "coverLetterId"   UUID,
    "notes"           TEXT,
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "applications_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "applications_userId_jobId_key"
    ON "applications" ("userId", "jobId");

CREATE INDEX "applications_userId_state_idx"
    ON "applications" ("userId", "state");

CREATE TABLE "application_events" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "applicationId" UUID           NOT NULL,
    "fromState"     TEXT,
    "toState"       TEXT           NOT NULL,
    "byActor"       TEXT           NOT NULL DEFAULT 'user',
    "notes"         TEXT,
    "at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_events_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE
);

CREATE INDEX "application_events_applicationId_at_idx"
    ON "application_events" ("applicationId", "at");
