-- F.5 (Wave F / P6): outreach messages.
--
-- One row per generated outreach draft. Status transitions:
--   draft     - just composed; awaiting approval
--   approved  - user hit approve; ready to send / stage in Gmail
--   sent      - user reported it went out (or Gmail draft was created)
--   discarded - user rejected the draft
--
-- Never batch-sent: every row is individually approvable per F.5 spec.
-- factRefs mirrors the resume + cover-letter pattern for the fact-check
-- gate audit trail.

CREATE TABLE "outreach_messages" (
  "id"                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID          NOT NULL,
  "application_id"    UUID,
  "template_id"       TEXT          NOT NULL,
  "industry_variant"  TEXT          NOT NULL DEFAULT 'default',
  "recipient_email"   TEXT          NOT NULL,
  "recipient_name"    TEXT,
  "recipient_role"    TEXT,
  "subject"           TEXT          NOT NULL,
  "body"              TEXT          NOT NULL,
  "fact_refs"         TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"            TEXT          NOT NULL DEFAULT 'draft',
  "send_at"           TIMESTAMPTZ,  -- suggested send time (business hours)
  "approved_at"       TIMESTAMPTZ,
  "sent_at"           TIMESTAMPTZ,
  "gmail_draft_id"    TEXT,         -- populated if gmail.compose scope is available
  "reply_message_id"  TEXT,         -- populated by future E.5b when a reply is detected
  "generated_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "outreach_messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "outreach_messages_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_messages_status_check"
    CHECK ("status" IN ('draft', 'approved', 'sent', 'discarded'))
);

CREATE INDEX "outreach_messages_user_status_generated_idx"
  ON "outreach_messages" ("user_id", "status", "generated_at" DESC);
CREATE INDEX "outreach_messages_user_send_at_idx"
  ON "outreach_messages" ("user_id", "send_at")
  WHERE "status" = 'approved' AND "sent_at" IS NULL;
