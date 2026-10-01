-- F.2 (Wave F / P6): ATS application submissions.
--
-- One row per attempted submission. Idempotency key = (application_id,
-- ats, idempotency_key) so a retry with the same key is a no-op upsert
-- rather than a duplicate POST. Status transitions:
--   pending   - row inserted, API call not yet made
--   submitted - 2xx from ATS; response_json has {confirmationUrl?,
--               atsApplicationId?, atsStatus?}
--   failed    - 4xx or exhausted retries; error carries the reason
--   cancelled - user cancelled before send (future)
--
-- `attempt_count` + `last_error` support observability on retry loops.
-- Composite index speeds up the F.9 dashboard's submissions_total
-- metric by (ats, result).

CREATE TABLE "ats_submissions" (
  "id"                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID          NOT NULL,
  "application_id"    UUID          NOT NULL,
  "ats"               TEXT          NOT NULL, -- 'ashby' | 'greenhouse'
  "idempotency_key"   TEXT          NOT NULL,
  "status"            TEXT          NOT NULL DEFAULT 'pending',
  "attempt_count"     INTEGER       NOT NULL DEFAULT 0,
  "last_error"        TEXT,
  "response_json"     JSONB,
  "submitted_at"      TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "ats_submissions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "ats_submissions_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "ats_submissions_unique_idempotency"
    UNIQUE ("application_id", "ats", "idempotency_key"),
  CONSTRAINT "ats_submissions_status_check"
    CHECK ("status" IN ('pending', 'submitted', 'failed', 'cancelled'))
);

CREATE INDEX "ats_submissions_user_status_created_idx"
  ON "ats_submissions" ("user_id", "status", "created_at" DESC);
CREATE INDEX "ats_submissions_ats_status_idx"
  ON "ats_submissions" ("ats", "status");
