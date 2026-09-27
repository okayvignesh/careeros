-- Promote evidence.signal from JSON detail to a first-class column so aggregators
-- don't have to parse JSONB on every read. Default 'presence' because that's the
-- most conservative treatment (records the claim without granting proficiency).
ALTER TABLE "evidence"
  ADD COLUMN "signal" TEXT NOT NULL DEFAULT 'presence';

-- Drop the speculative index (no consumer in slice 1); we'll add whatever slice 2
-- actually needs based on real query patterns.
DROP INDEX IF EXISTS "evidence_userId_kind_observedAt_idx";

-- Trace every skill_state_events row back to the triggering evidence (nullable
-- because longInactivity fires from time, not from an evidence row).
ALTER TABLE "skill_state_events"
  ADD COLUMN "evidenceId" UUID;

ALTER TABLE "skill_state_events"
  ADD CONSTRAINT "skill_state_events_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "evidence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "skill_state_events_evidenceId_idx"
  ON "skill_state_events" ("evidenceId");
