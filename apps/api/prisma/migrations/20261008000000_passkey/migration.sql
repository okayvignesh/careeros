-- C-P0.7: WebAuthn passkey + recovery-code tables.
--
--   passkey_credentials  — one row per registered authenticator per user.
--                          `credentialId` is the raw id bytes (unique across
--                          the whole system, per WebAuthn spec). `publicKey`
--                          is the COSE-encoded public key. `counter` is a
--                          BIGINT because the authenticator can report any
--                          uint32; we compare-and-set on login.
--
--   recovery_codes       — sha256 hashes of one-time recovery codes. Only the
--                          hash is stored. `usedAt` is set atomically on
--                          redeem so a code can be spent exactly once.
--
--   passkey_challenges   — outstanding registration/authentication challenges
--                          keyed by the challenge string itself. Consumed
--                          on verify and deleted; a cron/worker can sweep
--                          expired rows, but the verify path also refuses
--                          anything past `expiresAt`.

CREATE TABLE "passkey_credentials" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "credentialId" BYTEA          NOT NULL,
    "publicKey"    BYTEA          NOT NULL,
    "counter"      BIGINT         NOT NULL DEFAULT 0,
    "transports"   TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name"         TEXT,
    "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"   TIMESTAMPTZ(6),

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "passkey_credentials_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "passkey_credentials_credentialId_key"
    ON "passkey_credentials" ("credentialId");

CREATE INDEX "passkey_credentials_userId_idx"
    ON "passkey_credentials" ("userId");

CREATE TABLE "recovery_codes" (
    "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"    UUID           NOT NULL,
    "codeHash"  TEXT           NOT NULL,
    "usedAt"    TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recovery_codes_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "recovery_codes_codeHash_key"
    ON "recovery_codes" ("codeHash");

CREATE INDEX "recovery_codes_userId_idx"
    ON "recovery_codes" ("userId");

CREATE TABLE "passkey_challenges" (
    "challenge" TEXT           NOT NULL,
    "userId"    UUID,
    "kind"      TEXT           NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "passkey_challenges_pkey" PRIMARY KEY ("challenge"),
    CONSTRAINT "passkey_challenges_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "passkey_challenges_expiresAt_idx"
    ON "passkey_challenges" ("expiresAt");
