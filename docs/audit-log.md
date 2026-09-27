# Audit log

Career OS records privileged and user-consequential actions in the
`audit_log` table. The design goal is simple: once written, an audit row
cannot be rewritten or silently deleted by the application, even if the app
process is fully compromised.

## Append-only grants

Migration `20261012000005_audit_log_append_only` locks the table at the
database layer:

- App role `careeros` keeps `INSERT` and `SELECT`.
- `UPDATE`, `DELETE`, `TRUNCATE` are `REVOKE`d from `careeros`. The API has
  no code path that can rewrite or drop an audit row.
- Role `careeros_audit_reader` is created `NOLOGIN` with `SELECT` on
  `audit_log`. Operators grant `LOGIN` when they need to run reports and
  revoke it when done.

An attempt to `UPDATE` or `DELETE` from the app connection raises
`permission denied for relation audit_log`. The invariant is proved by the
integration test at
`apps/api/src/prisma/audit-log-append-only.integration.test.ts`.

## Retention: 365 days

Rows older than one year are removed daily by the worker job
`audit-log-retention` (cron `0 4 * * *`, 04:00 UTC).

The delete cannot come from the app connection (grants prevent it), so the
worker calls stored procedure `audit_log_retention_prune()`. The proc is
`SECURITY DEFINER` and runs as the DB owner. `EXECUTE` on the proc is
granted only to `careeros`; `search_path` is pinned to `pg_catalog, public`
per PostgreSQL guidance for `SECURITY DEFINER` functions.

Each run emits a pino line:

```
{ job: 'audit-log-retention', cutoff: '<iso>', deleted: <n> }
```

That line is the audit surface for retention. A self-referential
`audit_log` row per prune would defeat the point.

## Operator: read-only report access

`careeros_audit_reader` ships `NOLOGIN`. To run a report:

```
docker compose exec postgres psql -U postgres -d careeros \
  -c "ALTER ROLE careeros_audit_reader LOGIN PASSWORD '<one-time>';"

PGPASSWORD='<one-time>' psql -U careeros_audit_reader -d careeros -h <host>

docker compose exec postgres psql -U postgres -d careeros \
  -c "ALTER ROLE careeros_audit_reader NOLOGIN;"
```

Peer auth in a compose exec is equivalent; the point is that the read-only
role never carries a password at rest.

## Future work

Hash-chained rows (`prev_hash` column + verification script) are the next
step per plan/phase-6-controlled-execution.md#76. The append-only grants
below are the pre-condition: chain integrity is meaningless if the app can
overwrite links.
