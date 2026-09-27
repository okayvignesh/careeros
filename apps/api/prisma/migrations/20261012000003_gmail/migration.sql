-- E.4a: Gmail integration tables.
--
-- Two additive tables (no existing rows touched):
--
--   * gmail_watches            - one row per Gmail-connected user. Tracks
--                                the last-seen historyId (Gmail returns a
--                                uint64; stored as TEXT to avoid JS number
--                                precision loss) and the watch expiration
--                                so the daily renewal cron can re-arm any
--                                row within 24h of expiry.
--   * gmail_processed_messages - dedupe table. Pub/Sub push is
--                                at-least-once and history.list diffs can
--                                re-yield the same messageId across
--                                overlapping pushes. UNIQUE(userId,
--                                messageId) makes duplicate inserts a
--                                no-op the caller can catch as P2002.

CREATE TABLE "gmail_watches" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"      UUID           NOT NULL,
    "historyId"   TEXT           NOT NULL,
    "expiration"  TIMESTAMPTZ(6) NOT NULL,
    "topicName"   TEXT           NOT NULL,
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt"   TIMESTAMPTZ(6),

    CONSTRAINT "gmail_watches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gmail_watches_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "gmail_watches_userId_key" ON "gmail_watches" ("userId");
CREATE INDEX "gmail_watches_expiration_idx" ON "gmail_watches" ("expiration");

CREATE TABLE "gmail_processed_messages" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"      UUID           NOT NULL,
    "messageId"   TEXT           NOT NULL,
    "threadId"    TEXT,
    "receivedAt"  TIMESTAMPTZ(6) NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_processed_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gmail_processed_messages_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Idempotency backbone: second insert for the same (userId, messageId) hits
-- this unique index and Prisma throws P2002, which handlePubSubPush treats
-- as "already processed, skip".
CREATE UNIQUE INDEX "gmail_processed_messages_userId_messageId_key"
    ON "gmail_processed_messages" ("userId", "messageId");
CREATE INDEX "gmail_processed_messages_userId_processedAt_idx"
    ON "gmail_processed_messages" ("userId", "processedAt" DESC);
