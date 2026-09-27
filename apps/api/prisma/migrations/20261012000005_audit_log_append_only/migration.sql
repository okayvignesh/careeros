-- F.6a (Wave F / P6 controlled execution): lock down `audit_log` as append-only
-- at the DB layer. Even a fully compromised app account cannot rewrite or
-- forget history: UPDATE and DELETE are revoked from role `careeros` (the app
-- user). INSERT + SELECT remain so the API can keep writing audit rows and
-- reading them for the admin UI.
--
-- A separate read-only role `careeros_audit_reader` is created for operator
-- reporting: `psql -U careeros_audit_reader ...` can SELECT audit rows but
-- cannot touch anything else in the database.
--
-- Retention (1 year default, per plan/phase-6-controlled-execution.md#74) is
-- enforced by a daily worker that calls stored procedure
-- `audit_log_retention_prune()`. The proc runs `SECURITY DEFINER` as the DB
-- owner, so it bypasses the REVOKE above. This is the ONLY code path allowed
-- to remove audit rows; the worker owns it, the API cannot invoke it because
-- EXECUTE is not granted to `careeros`.
--
-- All statements are idempotent: `DO` blocks + `IF NOT EXISTS` + `CREATE OR
-- REPLACE`, safe to replay against a db that already has the objects.

-- ---------------------------------------------------------------------------
-- 1. Read-only reporting role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careeros_audit_reader') THEN
    CREATE ROLE careeros_audit_reader NOLOGIN;
  END IF;
END
$$;

COMMENT ON ROLE careeros_audit_reader IS
  'F.6: read-only role for audit_log reporting. NOLOGIN by default; an '
  'operator grants LOGIN + password (or peer auth) when they need to run '
  'reports. Never used by the app.';

GRANT SELECT ON "audit_log" TO careeros_audit_reader;

-- ---------------------------------------------------------------------------
-- 2. Revoke mutation grants from the app role.
-- ---------------------------------------------------------------------------
-- The app INSERTs audit rows through PrismaService and SELECTs them for the
-- admin UI. It must never UPDATE (would rewrite history) or DELETE (would
-- forget history). Retention runs via the SECURITY DEFINER proc below, not
-- the app connection.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careeros') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM careeros;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Retention proc, 365-day cutoff, SECURITY DEFINER.
-- ---------------------------------------------------------------------------
-- Runs as the function OWNER (the migration role, which is the DB owner in
-- practice) so the DELETE succeeds even though the caller (worker under
-- role `careeros`) has had DELETE revoked. Returns the number of rows
-- removed so the worker can emit an audit summary line.
--
-- `search_path` pinned per PostgreSQL security guidance for SECURITY DEFINER
-- functions: a mutable search_path is an escalation vector.
CREATE OR REPLACE FUNCTION audit_log_retention_prune()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  cutoff timestamptz := now() - interval '365 days';
  removed bigint;
BEGIN
  DELETE FROM "audit_log" WHERE "timestamp" < cutoff;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

COMMENT ON FUNCTION audit_log_retention_prune() IS
  'F.6: delete audit_log rows older than 365 days. SECURITY DEFINER so the '
  'worker (running as `careeros`, which has DELETE revoked) can still enforce '
  'retention. Called daily by apps/worker/src/audit-log-retention.worker.ts.';

-- Explicit lockdown: revoke PUBLIC (default grant) and then hand EXECUTE
-- ONLY to the app role. Prevents an accidental future role from calling it.
REVOKE ALL ON FUNCTION audit_log_retention_prune() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careeros') THEN
    GRANT EXECUTE ON FUNCTION audit_log_retention_prune() TO careeros;
  END IF;
END
$$;
