-- P1 job-targeting §4: extend the canonical targeting profile
-- (`user_job_preferences`). Additive only — legacy `locations` free-text stays
-- and every new array defaults to empty so existing rows stay valid without a
-- backfill (the data backfill runs last, in 20261014000200).
ALTER TABLE "user_job_preferences"
  ADD COLUMN "workplaceTypes"      TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "remoteScopes"        TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "countries"           TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cities"              JSONB    NOT NULL DEFAULT '[]',
  ADD COLUMN "homeCountry"         CHAR(2),
  ADD COLUMN "citizenships"        TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "workAuthorizations"  TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sponsorshipCountries" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "relocationWilling"   BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN "relocationCountries" TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "timezoneOverlapHours" INTEGER,
  ADD COLUMN "language"            TEXT     DEFAULT 'en';
