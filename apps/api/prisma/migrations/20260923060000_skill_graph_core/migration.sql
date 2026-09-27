-- P1 slice 1: skill graph core (skills, evidence, candidate_skill_state, skill_state_events).
-- Deferred: skill_edges (prereq graph), github_repos/analyses (slice 2), facts/fact_versions (slice 5).

CREATE TABLE "skills" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "cluster"   TEXT,
    "aliases"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "skills_cluster_idx" ON "skills" ("cluster");

CREATE TABLE "evidence" (
    "id"         UUID NOT NULL,
    "userId"     UUID NOT NULL,
    "skillId"    TEXT NOT NULL,
    "kind"       TEXT NOT NULL,
    "weightHint" DECIMAL(4,3),
    "sourceRef"  JSONB,
    "detail"     JSONB,
    "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evidence_userId_skillId_observedAt_idx"
  ON "evidence" ("userId", "skillId", "observedAt");
CREATE INDEX "evidence_userId_kind_observedAt_idx"
  ON "evidence" ("userId", "kind", "observedAt");

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "skills"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "candidate_skill_state" (
    "userId"                 UUID NOT NULL,
    "skillId"                TEXT NOT NULL,
    "proficiency"            DECIMAL(5,2) NOT NULL,
    "confidence"             DECIMAL(4,3) NOT NULL,
    "recencyDays"            INTEGER NOT NULL,
    "historicalDemonstrated" BOOLEAN NOT NULL DEFAULT false,
    "evidenceCount"          INTEGER NOT NULL DEFAULT 0,
    "level"                  INTEGER NOT NULL DEFAULT 1,
    "updatedAt"              TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "candidate_skill_state_pkey" PRIMARY KEY ("userId", "skillId")
);

CREATE INDEX "candidate_skill_state_userId_level_idx"
  ON "candidate_skill_state" ("userId", "level");

ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_skill_state"
  ADD CONSTRAINT "candidate_skill_state_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "skills"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "skill_state_events" (
    "id"         UUID NOT NULL,
    "userId"     UUID NOT NULL,
    "skillId"    TEXT NOT NULL,
    "rule"       TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson"  JSONB,
    "timestamp"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_state_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "skill_state_events_userId_skillId_timestamp_idx"
  ON "skill_state_events" ("userId", "skillId", "timestamp");

ALTER TABLE "skill_state_events"
  ADD CONSTRAINT "skill_state_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
