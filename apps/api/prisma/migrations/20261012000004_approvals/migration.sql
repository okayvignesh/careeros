-- F.1 (Wave F / P6 controlled execution): approval queue tables.
--
--   approval_items   - one row per outbound action an agent proposed. The
--                      state machine ('pending' -> 'approved' -> 'sent'|'failed';
--                      'pending' -> 'cancelled') is enforced in
--                      apps/api/src/modules/approvals/state-machine.ts, not by
--                      a check constraint - the code guard already blocks bad
--                      writes and a constraint here would fight future kinds.
--   approval_events  - append-only audit trail per item (enqueued, approved,
--                      cancelled, sent, failed, bulk_reauth_required).
--
-- Indexes:
--   (userId, state, createdAt) - hot path for the pending-queue UI (state='pending'
--                                filtered, chronological).
--   (userId, createdAt desc)   - full history feed.
--   (approvalItemId, at)       - render event timeline in item detail.

CREATE TABLE "approval_items" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "kind"         TEXT           NOT NULL,
    "payload"      JSONB          NOT NULL,
    "diffJson"     JSONB          NOT NULL,
    "state"        TEXT           NOT NULL DEFAULT 'pending',
    "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt"    TIMESTAMPTZ(6),
    "sentAt"       TIMESTAMPTZ(6),
    "failedReason" TEXT,

    CONSTRAINT "approval_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_items_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "approval_items_userId_state_createdAt_idx"
    ON "approval_items" ("userId", "state", "createdAt");
CREATE INDEX "approval_items_userId_createdAt_idx"
    ON "approval_items" ("userId", "createdAt" DESC);

CREATE TABLE "approval_events" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "approvalItemId" UUID           NOT NULL,
    "event"          TEXT           NOT NULL,
    "actor"          TEXT           NOT NULL DEFAULT 'user',
    "meta"           JSONB,
    "at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_events_approvalItemId_fkey"
        FOREIGN KEY ("approvalItemId") REFERENCES "approval_items"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "approval_events_approvalItemId_at_idx"
    ON "approval_events" ("approvalItemId", "at");
