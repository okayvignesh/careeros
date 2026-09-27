-- C-P1.6a: GitLab integration prisma changes.
--
-- Additive-only:
--   * add `baseUrl` (nullable) to `integrations` so a self-hosted enterprise
--     GitLab can be recorded. Always NULL for github.com + gitlab.com. The
--     value is validated (assertPublicUrl + per-user allowlist) BEFORE any
--     row is persisted (A-C2 + A-H6b), so the column itself carries no
--     integrity check beyond nullability.
--
-- The `kind` column stays a plain TEXT discriminator — the model comment now
-- mentions 'gitlab' but no CHECK constraint exists on `kind` today (mirrors
-- how 'github' | 'slack' | 'gmail' were already permitted). Adding a CHECK
-- would tighten this but would also require lockstep migrations every time a
-- new integration lands, so we defer.

ALTER TABLE "integrations"
    ADD COLUMN "baseUrl" TEXT;
