-- P1 job-targeting §5: structured geography + sponsorship on `jobs_normalized`.
-- All columns nullable (an unparsed row is honest, never guessed). The
-- sponsorship enum defaults to `unclear` so a missing signal can never be read
-- as a positive one.
CREATE TYPE "SponsorshipSignal" AS ENUM ('likely', 'unclear', 'none');

ALTER TABLE "jobs_normalized"
  ADD COLUMN "country"             CHAR(2),
  ADD COLUMN "region"              TEXT,
  ADD COLUMN "city"                TEXT,
  ADD COLUMN "workplaceType"       TEXT,
  ADD COLUMN "remoteScope"         TEXT,
  ADD COLUMN "sponsorshipSignal"   "SponsorshipSignal" NOT NULL DEFAULT 'unclear',
  ADD COLUMN "sponsorshipEvidence" JSONB,
  ADD COLUMN "geoParsedAt"         TIMESTAMPTZ(6),
  -- Parsed comp band in its original currency. `compFit` must never compare
  -- across currencies, so the job-side currency + band are persisted here.
  ADD COLUMN "compCurrency"        CHAR(3),
  ADD COLUMN "compMin"             INTEGER,
  ADD COLUMN "compMax"             INTEGER;

-- Optional per §5; cheap and used by the market-scoped reads.
CREATE INDEX "jobs_normalized_country_region_workplaceType_idx"
  ON "jobs_normalized"("country", "region", "workplaceType");
