-- D.2 (Wave D / P3.5 desktop companion agent): four tables that back the
-- device-pairing + JWT + WSS surface.
--
--   agent_devices           — one row per paired desktop-agent instance.
--                             `publicKey` is the raw public-key bytes the
--                             agent generated during pairing (agent keeps
--                             the private half in OS keychain). `revokedAt`
--                             is a soft-delete: once set, every JWT-authed
--                             request is 401 and any WSS is dropped.
--
--   agent_tasks             — queue of work the server pushes to a device
--                             over WSS. `status` in ('queued' | 'in_progress'
--                             | 'completed' | 'failed' | 'timeout').
--
--   agent_sessions          — server-side JWT store. `jwtHash` +
--                             `refreshHash` are sha256(hex) so a leaked
--                             token is revocable without waiting for TTL.
--                             Refresh rotation deletes the old row and
--                             inserts a new one in one tx.
--
--   agent_pairing_requests  — short-lived pairing-code rows. `codeHash` is
--                             sha256(hex) of the 6-digit numeric code. A
--                             new start for the same user invalidates prior
--                             rows.

CREATE TABLE "agent_devices" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "name"         TEXT           NOT NULL,
    "publicKey"    BYTEA          NOT NULL,
    "pairedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"    TIMESTAMPTZ(6),
    "lastSeenAt"   TIMESTAMPTZ(6),
    "agentVersion" TEXT,

    CONSTRAINT "agent_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_devices_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "agent_devices_userId_idx"   ON "agent_devices" ("userId");
CREATE INDEX "agent_devices_revokedAt_idx" ON "agent_devices" ("revokedAt");

CREATE TABLE "agent_tasks" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "deviceId"    UUID           NOT NULL,
    "kind"        TEXT           NOT NULL,
    "params"      JSONB          NOT NULL,
    "status"      TEXT           NOT NULL DEFAULT 'queued',
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"   TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "resultJson"  JSONB,
    "expiresAt"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_tasks_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES "agent_devices"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "agent_tasks_deviceId_status_idx" ON "agent_tasks" ("deviceId", "status");
CREATE INDEX "agent_tasks_expiresAt_idx"       ON "agent_tasks" ("expiresAt");

CREATE TABLE "agent_sessions" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "deviceId"    UUID           NOT NULL,
    "jwtHash"     TEXT           NOT NULL,
    "refreshHash" TEXT           NOT NULL,
    "issuedAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"   TIMESTAMPTZ(6) NOT NULL,
    "revokedAt"   TIMESTAMPTZ(6),

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_sessions_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES "agent_devices"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_sessions_jwtHash_key"     ON "agent_sessions" ("jwtHash");
CREATE UNIQUE INDEX "agent_sessions_refreshHash_key" ON "agent_sessions" ("refreshHash");
CREATE INDEX        "agent_sessions_deviceId_idx"    ON "agent_sessions" ("deviceId");
CREATE INDEX        "agent_sessions_expiresAt_idx"   ON "agent_sessions" ("expiresAt");

CREATE TABLE "agent_pairing_requests" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"     UUID           NOT NULL,
    "codeHash"   TEXT           NOT NULL,
    "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),

    CONSTRAINT "agent_pairing_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_pairing_requests_codeHash_key"     ON "agent_pairing_requests" ("codeHash");
CREATE INDEX        "agent_pairing_requests_userId_expiresAt_idx" ON "agent_pairing_requests" ("userId", "expiresAt");
