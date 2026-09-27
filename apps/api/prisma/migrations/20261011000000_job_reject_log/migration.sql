-- C-P3.2d: per-verify-rejection audit table.
--
-- Additive. Written by JobsService.sync whenever the verify stage returns
-- verdict='rejected'. Powers the reject-audit admin UI (web slice deferred)
-- and the re-verify POST endpoint.
--
-- No FK on `jobRawId`: `jobs_raw` is append-only and we want to be free to
-- expire raw rows later without cascading through the reject log. Kept as
-- UUID for shape symmetry with the parent id.

CREATE TABLE "job_reject_log" (
    "id"          UUID           NOT NULL,
    "jobRawId"    UUID,
    "sourceId"    TEXT           NOT NULL,
    "sourceName"  TEXT           NOT NULL,
    "rejectedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason"      TEXT           NOT NULL,
    "verdict"     TEXT           NOT NULL DEFAULT 'rejected',
    "details"     JSONB          NOT NULL,

    CONSTRAINT "job_reject_log_pkey" PRIMARY KEY ("id")
);

-- Freshest-first paginated read.
CREATE INDEX "job_reject_log_rejectedAt_idx"
    ON "job_reject_log" ("rejectedAt" DESC);

-- Filter by adapter (?adapter=remotive).
CREATE INDEX "job_reject_log_sourceName_rejectedAt_idx"
    ON "job_reject_log" ("sourceName", "rejectedAt" DESC);

-- Filter by reason code (?reason=stale).
CREATE INDEX "job_reject_log_reason_rejectedAt_idx"
    ON "job_reject_log" ("reason", "rejectedAt" DESC);
