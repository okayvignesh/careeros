-- Per-user job-search preferences. One row per user (upsert semantics — users
-- always have prefs, they just start empty). Drives the relevance filter stage
-- of the job pipeline in `JobsService.list`.

CREATE TABLE "user_job_preferences" (
    "userId"             UUID           NOT NULL,
    "targetRoles"        TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "locations"          TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "remoteOnly"         BOOLEAN        NOT NULL DEFAULT false,
    "compMin"            INTEGER,
    "compMax"            INTEGER,
    "currency"           CHAR(3)        NOT NULL DEFAULT 'USD',
    "seniority"          TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mustHaveSkills"     TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dealbreakerSkills"  TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "companyBlacklist"   TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_job_preferences_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "user_job_preferences_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
