-- E.7 (Wave E / P5): inbox triage + email-application fuzzy links.
--
-- inbox_items:
--   One row per inbound email that reached the pipeline. `class` is the
--   E.5 classifier output. `linked_application_id` set when the fuzzy
--   matcher hit >= 0.85. `status`:
--     new       - awaiting user review (or below auto-link threshold)
--     linked    - matched to an application (auto or manual)
--     dismissed - user hit dismiss on the triage screen
--
-- email_application_links:
--   Soft link (unlinkable). `confidence` is the fuzzy score at link
--   time; `by` is `auto` (matcher) or `user` (manual override).
--   `unlinked_at` set on unlink so the audit trail survives.
--   Composite unique on (email_id, application_id) so a re-link is a
--   no-op upsert instead of duplicates.

CREATE TABLE "inbox_items" (
  "id"                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"               UUID          NOT NULL,
  "email_id"              TEXT          NOT NULL, -- Gmail message id
  "from_address"          TEXT          NOT NULL,
  "subject"               TEXT          NOT NULL,
  "snippet"               TEXT,
  "class"                 TEXT          NOT NULL,
  "class_confidence"      REAL          NOT NULL,
  "linked_application_id" UUID,
  "status"                TEXT          NOT NULL DEFAULT 'new', -- new | linked | dismissed
  "arrived_at"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "reviewed_at"           TIMESTAMPTZ,

  CONSTRAINT "inbox_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "inbox_items_linked_application_id_fkey"
    FOREIGN KEY ("linked_application_id") REFERENCES "applications"("id") ON DELETE SET NULL,
  CONSTRAINT "inbox_items_user_email_unique"
    UNIQUE ("user_id", "email_id")
);

CREATE INDEX "inbox_items_user_status_arrived_idx"
  ON "inbox_items" ("user_id", "status", "arrived_at" DESC);
CREATE INDEX "inbox_items_user_linked_application_idx"
  ON "inbox_items" ("user_id", "linked_application_id")
  WHERE "linked_application_id" IS NOT NULL;


CREATE TABLE "email_application_links" (
  "id"             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID          NOT NULL,
  "inbox_item_id"  UUID          NOT NULL,
  "application_id" UUID          NOT NULL,
  "confidence"     REAL          NOT NULL,
  "by"             TEXT          NOT NULL DEFAULT 'auto', -- auto | user
  "linked_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "unlinked_at"    TIMESTAMPTZ,

  CONSTRAINT "email_application_links_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "email_application_links_inbox_item_id_fkey"
    FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_items"("id") ON DELETE CASCADE,
  CONSTRAINT "email_application_links_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "email_application_links_unique"
    UNIQUE ("inbox_item_id", "application_id")
);

CREATE INDEX "email_application_links_user_application_idx"
  ON "email_application_links" ("user_id", "application_id");
