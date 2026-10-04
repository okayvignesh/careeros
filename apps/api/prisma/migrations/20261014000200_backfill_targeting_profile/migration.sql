-- P1 job-targeting §4 + §5: data backfill, runs last (columns exist).
--
-- (1) Conflict-safe CareerGoal → UserJobPreferences unification. Users who have
--     a goal but no profile get one copied from their goal; users with both get
--     empty profile fields filled from the goal. Existing non-empty profile
--     values always win, so running this twice is idempotent.
-- (2) Promote legacy `jobs_normalized` rows to `discovered` (ingest used to
--     leave them at the `unverified` default). Verified rows are never touched.

-- (1a) Insert a profile for every goal owner with no profile yet.
INSERT INTO "user_job_preferences" (
  "userId", "targetRoles", "locations", "remoteOnly", "compMin", "compMax",
  "currency", "seniority", "mustHaveSkills", "dealbreakerSkills",
  "companyBlacklist", "workplaceTypes", "remoteScopes", "countries", "cities",
  "citizenships", "workAuthorizations", "sponsorshipCountries",
  "relocationWilling", "relocationCountries", "language", "updatedAt"
)
SELECT
  g."userId",
  COALESCE(g."targetRoles", ARRAY[]::TEXT[]),
  COALESCE(g."locations", ARRAY[]::TEXT[]),
  COALESCE(g."remoteOnly", false),
  g."compMin",
  g."compMax",
  COALESCE(NULLIF(g."currency", ''), 'USD'),
  COALESCE(g."seniority", ARRAY[]::TEXT[]),
  ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[],
  ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], '[]'::jsonb,
  ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[],
  false, ARRAY[]::TEXT[], 'en',
  CURRENT_TIMESTAMP
FROM "career_goals" g
WHERE NOT EXISTS (
  SELECT 1 FROM "user_job_preferences" p WHERE p."userId" = g."userId"
);

-- (1b) Fill only the empty fields of existing profiles from the goal.
UPDATE "user_job_preferences" p
SET
  "targetRoles" = CASE WHEN cardinality(p."targetRoles") = 0 THEN COALESCE(g."targetRoles", p."targetRoles") ELSE p."targetRoles" END,
  "locations"   = CASE WHEN cardinality(p."locations")   = 0 THEN COALESCE(g."locations",   p."locations")   ELSE p."locations"   END,
  "remoteOnly"  = CASE WHEN p."remoteOnly" = false            THEN COALESCE(g."remoteOnly",  p."remoteOnly")  ELSE p."remoteOnly"  END,
  "compMin"     = COALESCE(p."compMin", g."compMin"),
  "compMax"     = COALESCE(p."compMax", g."compMax"),
  "seniority"   = CASE WHEN cardinality(p."seniority")   = 0 THEN COALESCE(g."seniority",   p."seniority")   ELSE p."seniority"   END
FROM "career_goals" g
WHERE p."userId" = g."userId";

-- (2) Legacy state promotion: ingest never set `state`, so rows sat at the
--     `unverified` default. Conservative backfill to `discovered`; anything
--     already verified/discovered/stale/closed is left alone.
UPDATE "jobs_normalized"
SET "state" = 'discovered'
WHERE "state" = 'unverified';
