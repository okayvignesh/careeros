-- LLM-extracted skill IDs on each normalized job. `skillsExtractedAt` records
-- when extraction ran so a re-run can prefer unprocessed rows first. GIN index
-- powers the `?skill=X` filter path on `GET /jobs`.

ALTER TABLE "jobs_normalized"
    ADD COLUMN "skillIds"          TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "skillsExtractedAt" TIMESTAMPTZ(6);

CREATE INDEX "jobs_normalized_skillIds_idx"
    ON "jobs_normalized" USING GIN ("skillIds");
