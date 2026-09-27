-- C-P4.4: CompanyDossier snapshot table. Additive; no other model touched.
--
--   company_dossiers  One row per company (companyId is the free-form
--                     `NormalizedJob.company` string; no Company FK table yet).
--                     Stage outputs live in dedicated JSON columns so a
--                     partial re-run can update just one stage in place.
--                     `synthesis` is the LLM narrative; `factRefs` names the
--                     evidence ids the LLM was allowed to cite. Cache TTL is
--                     enforced in code via `staleAfter`; the index on
--                     staleAfter lets a future refresher worker scan expired
--                     rows without a seq scan.

CREATE TABLE "company_dossiers" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "companyId"    TEXT           NOT NULL,
    "identity"     JSONB          NOT NULL,
    "techSignals"  JSONB          NOT NULL,
    "reviews"      JSONB          NOT NULL,
    "interviews"   JSONB          NOT NULL,
    "recentEvents" JSONB          NOT NULL,
    "synthesis"    TEXT           NOT NULL,
    "factRefs"     TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "generatedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleAfter"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_dossiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_dossiers_companyId_key"
    ON "company_dossiers" ("companyId");

CREATE INDEX "company_dossiers_staleAfter_idx"
    ON "company_dossiers" ("staleAfter");
