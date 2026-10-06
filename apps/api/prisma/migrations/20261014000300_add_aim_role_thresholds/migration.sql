-- P2 job-targeting §8: per-user, per-role proficiency threshold for the
-- learning-priority formula. Unique on (userId, roleKey); a missing row means
-- "use the default" (TARGET_ROLE_PROF = 0.700 / TARGET_DEFAULT_PROF = 0.500 in
-- src/modules/skills/learning-priority.ts).
--
-- The seed below mirrors ROLE_SKILLS keys in src/modules/skills/role-skill-map.ts
-- (ROLE_FAMILIES) at the target-role bar 0.700. It is idempotent:
-- ON CONFLICT DO NOTHING. A unit test asserts the two lists stay in sync.
CREATE TABLE "aim_role_thresholds" (
  "id"        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    UUID          NOT NULL,
  "roleKey"   TEXT          NOT NULL,
  "threshold" DECIMAL(4,3)  NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "aim_role_thresholds_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "aim_role_thresholds_userId_roleKey_key"
  ON "aim_role_thresholds"("userId", "roleKey");

-- Seed one row per existing user per role family. New users fall back to the
-- constants until a row is written, so this is a convenience, not a requirement.
INSERT INTO "aim_role_thresholds" ("userId", "roleKey", "threshold")
SELECT u."id", r."roleKey", 0.700
FROM "users" u
CROSS JOIN (
  VALUES
    ('backend'),
    ('frontend'),
    ('fullstack'),
    ('mobile'),
    ('devops'),
    ('sre'),
    ('platform'),
    ('data-engineer'),
    ('data-scientist'),
    ('ml-engineer'),
    ('security'),
    ('engineering-manager')
) AS r("roleKey")
ON CONFLICT ("userId", "roleKey") DO NOTHING;
