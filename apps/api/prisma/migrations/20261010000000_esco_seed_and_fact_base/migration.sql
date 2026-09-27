-- C-P1.3: ESCO skill taxonomy fields + master fact base tables.
--
-- Additive only. The Skill table gains three nullable columns so seed rows
-- can carry canonical ESCO ids while every legacy row (already keyed by
-- id/name/cluster/aliases) stays valid without backfill.
--
-- Two new tables:
--   * skill_facts  - per-user claims about a skill (grounded generation input)
--   * fact_base    - subject/predicate/object triples deduped by factHash

-- ---- Skill: ESCO fields --------------------------------------------------
ALTER TABLE "skills"
    ADD COLUMN "category" TEXT DEFAULT 'uncategorized',
    ADD COLUMN "escoId"   TEXT,
    ADD COLUMN "escoUri"  TEXT;

CREATE UNIQUE INDEX "skills_escoId_key" ON "skills" ("escoId");
CREATE INDEX "skills_category_idx"     ON "skills" ("category");

-- ---- skill_facts ---------------------------------------------------------
CREATE TABLE "skill_facts" (
    "id"         UUID        NOT NULL,
    "userId"     UUID        NOT NULL,
    "skillId"    TEXT        NOT NULL,
    "factType"   TEXT        NOT NULL,
    "claim"      TEXT        NOT NULL,
    "sourceRef"  TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_facts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "skill_facts_userId_skillId_idx"  ON "skill_facts" ("userId", "skillId");
CREATE INDEX "skill_facts_userId_factType_idx" ON "skill_facts" ("userId", "factType");

ALTER TABLE "skill_facts"
    ADD CONSTRAINT "skill_facts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_facts"
    ADD CONSTRAINT "skill_facts_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "skills"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- fact_base -----------------------------------------------------------
CREATE TABLE "fact_base" (
    "id"         UUID        NOT NULL,
    "userId"     UUID        NOT NULL,
    "factHash"   TEXT        NOT NULL,
    "subject"    TEXT        NOT NULL,
    "predicate"  TEXT        NOT NULL,
    "object"     TEXT        NOT NULL,
    "source"     TEXT        NOT NULL,
    "sourceRef"  TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_base_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fact_base_factHash_key"   ON "fact_base" ("factHash");
CREATE INDEX "fact_base_userId_subject_idx"    ON "fact_base" ("userId", "subject");
CREATE INDEX "fact_base_userId_predicate_idx"  ON "fact_base" ("userId", "predicate");

ALTER TABLE "fact_base"
    ADD CONSTRAINT "fact_base_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
