-- E.3 (Wave E / P5): daily-brief preferences.
--
-- One row per user (id = userId per PK). Absence of a row means "not
-- yet configured"; the scheduler treats that as opted-out until the
-- user hits POST /brief/preferences.
--
-- send_hour_local is 0-23 in the user's IANA timezone; the scheduler
-- converts to UTC on each enqueue so DST transitions are respected.
--
-- channels is a small text[] (any subset of the ChannelKind union in
-- @careeros/messaging: 'web' | 'slack' | 'whatsapp' | 'discord').
-- Empty array = user has an opt-in row but no delivery channels; the
-- worker still composes the brief and writes it to audit_log so the
-- daily job is idempotent and the user can retrieve it via the API
-- once the UI ships.
--
-- snoozed_until is nullable; a past timestamp is a no-op.

CREATE TABLE "daily_brief_preferences" (
  "user_id"           UUID          PRIMARY KEY,
  "is_enabled"        BOOLEAN       NOT NULL DEFAULT true,
  "timezone"          TEXT          NOT NULL DEFAULT 'UTC',
  "send_hour_local"   SMALLINT      NOT NULL DEFAULT 8,
  "channels"          TEXT[]        NOT NULL DEFAULT ARRAY['web']::TEXT[],
  "snoozed_until"     TIMESTAMPTZ,
  "last_sent_at"      TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "daily_brief_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "daily_brief_preferences_send_hour_local_range"
    CHECK ("send_hour_local" >= 0 AND "send_hour_local" <= 23)
);

CREATE INDEX "daily_brief_preferences_is_enabled_idx"
  ON "daily_brief_preferences" ("is_enabled");
