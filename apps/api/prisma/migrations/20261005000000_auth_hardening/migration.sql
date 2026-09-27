-- Wave A-auth: two tables for A-C1 (exponential login lockout) and A-H3
-- (server-side session revocation).
--
--   login_attempts    — one row per sign-in attempt, keyed on (email, ip).
--                       The exponential-lockout logic in AuthService counts
--                       consecutive failures since the last success in
--                       the last 15 min window.
--
--   active_sessions   — one row per sealed cookie. `id` is the random UUID
--                       written into the cookie payload; a cookie is only
--                       accepted if this row exists and has not expired.
--                       Password change deletes all rows for the user in
--                       the same transaction as the hash update.

CREATE TABLE "login_attempts" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "email"       TEXT           NOT NULL,
    "ip"          TEXT           NOT NULL,
    "ok"          BOOLEAN        NOT NULL DEFAULT FALSE,
    "reason"      TEXT,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_ip_attemptedAt_idx"
    ON "login_attempts" ("email", "ip", "attemptedAt");

CREATE INDEX "login_attempts_attemptedAt_idx"
    ON "login_attempts" ("attemptedAt");

CREATE TABLE "active_sessions" (
    "id"        UUID           NOT NULL,
    "userId"    UUID           NOT NULL,
    "issuedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "ip"        TEXT,
    "userAgent" TEXT,

    CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "active_sessions_userId_idx"
    ON "active_sessions" ("userId");

CREATE INDEX "active_sessions_expiresAt_idx"
    ON "active_sessions" ("expiresAt");
