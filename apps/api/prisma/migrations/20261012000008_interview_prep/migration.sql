-- F.4 (Wave F / P6): interview prep + talk-tracks.
--
-- One row per (user, application). `plan` is JSON:
--   { topics: [{ id, title, source, evidenceFactIds: [], suggestedDuration }] }
-- `talkTracks` is JSON keyed by topic id:
--   { <topicId>: { draft, factRefs: [], generatedAt } }
-- Both stored as JSONB so the initial plan generation + iterative
-- talk-track generation share one row without churning schema.

CREATE TABLE "interview_prep" (
  "id"              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         UUID          NOT NULL,
  "application_id"  UUID          NOT NULL,
  "plan"            JSONB         NOT NULL,
  "talk_tracks"     JSONB         NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "interview_prep_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "interview_prep_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "interview_prep_user_application_unique"
    UNIQUE ("user_id", "application_id")
);

CREATE INDEX "interview_prep_user_created_idx"
  ON "interview_prep" ("user_id", "created_at" DESC);
