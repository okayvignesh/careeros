-- P3 walking-skeleton: two tables cover the "ingest → normalize → land" path.
-- Skill-extract / verification-states / relevance / match-score all defer to
-- follow-up slices. jobs_raw is append-only per AGENTS.md rule (never overwrite
-- raw records). jobs_normalized dedupes by canonicalUrl for the walking-skeleton;
-- cross-source fuzzy-match dedupe lands with adapter #2.

CREATE TABLE "jobs_raw" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "source"       TEXT           NOT NULL,
    "sourceId"     TEXT           NOT NULL,
    "canonicalUrl" TEXT           NOT NULL,
    "payload"      JSONB          NOT NULL,
    "fetchedAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_raw_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "jobs_raw_source_id_fetched_idx"
    ON "jobs_raw" ("source", "sourceId", "fetchedAt");

CREATE INDEX "jobs_raw_canonical_idx"
    ON "jobs_raw" ("canonicalUrl");

CREATE TABLE "jobs_normalized" (
    "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
    "canonicalUrl"    TEXT           NOT NULL,
    "title"           TEXT           NOT NULL,
    "company"         TEXT           NOT NULL,
    "location"        TEXT,
    "remote"          BOOLEAN        NOT NULL DEFAULT false,
    "description"     TEXT           NOT NULL,
    "sourcePostedAt"  TIMESTAMPTZ(6),
    "primarySource"   TEXT           NOT NULL,
    "sourceIds"       TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "state"           TEXT           NOT NULL DEFAULT 'unverified',
    "firstSeenAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_normalized_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "jobs_normalized_canonicalUrl_key"
    ON "jobs_normalized" ("canonicalUrl");

CREATE INDEX "jobs_normalized_primarySource_idx"
    ON "jobs_normalized" ("primarySource");

CREATE INDEX "jobs_normalized_sourcePostedAt_idx"
    ON "jobs_normalized" ("sourcePostedAt" DESC);
