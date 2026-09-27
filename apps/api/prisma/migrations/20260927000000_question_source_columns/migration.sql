-- Source attribution for corpus-ingested questions. Existing LLM-generated rows
-- carry null values (backwards-compatible). When set, runners display
-- sourceAttribution + link to satisfy the source's license terms.

ALTER TABLE "question_bank"
    ADD COLUMN "sourceKind"        TEXT,
    ADD COLUMN "sourceUrl"         TEXT,
    ADD COLUMN "sourceAttribution" TEXT;

CREATE INDEX "question_bank_sourceKind_idx"
    ON "question_bank" ("sourceKind");
