-- C-P2.7e: nullable `embeddingId` on `question_bank` for the weekly corpus
-- refresh worker's near-duplicate cache. Additive; existing rows stay null
-- until re-ingested. The refresh worker uses this id as the Qdrant point id
-- so a re-run finds and updates the same vector rather than orphaning it.
ALTER TABLE "question_bank"
  ADD COLUMN "embeddingId" TEXT;
