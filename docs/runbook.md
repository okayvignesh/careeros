# Operator runbook

Daily / weekly / incident procedures for someone running Career OS on
their own VPS. Read `docs/install.md` first if you haven't booted the
stack yet.

## Daily

Nothing. The stack is designed to run unattended.

If you want to peek:

```bash
pnpm docker:ps              # service status
pnpm docker:logs | less     # tailed logs
curl -s https://<host>/health | jq
```

## Weekly

- Confirm the restore-test workflow ran green on Monday
  (`.github/workflows/restore-test.yml`). A failure means your
  nightly backups do not actually restore; treat as P1.
- Scan the Renovate PRs that landed Monday 06:00 UTC. Patch + minor
  deps are safe to merge once tests pass. Major bumps need a read.
- Review `/me/usage/anomaly?window=7d` for cost spikes.

## On deploy

```bash
git pull
pnpm install
pnpm migrate                  # runs any pending Prisma migrations
pnpm docker:rebuild           # rebuilds images

# If you added or changed a dep in apps/api or apps/web:
docker compose up -d --build --renew-anon-volumes api web
# (Without --renew-anon-volumes the container keeps the old build.)

# Then verify the service is healthy:
curl -sf https://<host>/health
```

Rollback: `git checkout <previous-tag>` + the same `pnpm migrate`
command (Prisma migrations are forward-only; a bad schema change needs
a NEW migration that reverts it, never a `migrate reset`).

## Common operations

### Pause all LLM calls

```bash
curl -X POST https://<host>/me/usage/pause \
  -b 'session=...' \
  -d '{"paused": true}' \
  -H 'content-type: application/json'
```

Unpause by posting `{"paused": false}`. Admin-only (requires fresh re-auth).

### Pause the sandbox (code-execution)

```bash
touch /var/lib/careeros/sandbox.paused   # if operator-shell
# OR:
curl -X POST https://<host>/admin/sandbox/pause -b 'session=...'
```

### Reset a locked-out account

```bash
docker compose exec api sh -c 'psql $DATABASE_URL -c "DELETE FROM login_attempts WHERE email = $1" <email>'
```

### Rotate `MASTER_KEY`

**Non-trivial** because every `encrypted_secrets` row is bound to the
old key via AAD. Procedure:

1. Export every secret via the old key (`scripts/rotate-master-key.sh --dump`).
2. Generate a new key (`openssl rand -hex 32`).
3. Re-encrypt and re-import under the new key.
4. Update `.env` and restart `api`.

Do NOT change `MASTER_KEY` without running the dump + reimport, or
you will brick every integration.

### Reset the Qdrant vector store

```bash
docker compose stop api worker
docker compose exec qdrant rm -rf /qdrant/storage/*
docker compose start api worker
curl -X POST https://<host>/admin/embeddings/reindex -b 'session=...'
```

Only needed if the vector dim or embedder changed; otherwise never.

## Backup + restore

Full procedure in `docs/backup.md`. Short form:

- Nightly: `scripts/backup.sh` runs via cron; writes `age`-encrypted
  bundle to the configured destination (S3 / B2 / rsync; see §6
  decision 3).
- Verify monthly: pull one backup, run `scripts/restore.sh --dry-run`,
  confirm row counts match.
- Full restore drill quarterly: fresh VPS, restore, boot, click
  through the wizard, confirm sign-in works.

## Alerts to configure

Recommended alert set (see `plan/observability.md`):

| Metric | Threshold | Severity |
|---|---|---|
| `approvals_pending` > 24h | > 0 for > 24h | warn |
| `submissions_total` with `result=failed` | > 20% over 1h | critical |
| `backup_last_success_seconds_ago` | > 48h | critical |
| `restore_test_pass` | false | critical |
| `llm_calls_total` / sum(cost) | > 3x 7d median | critical (see F.9 anomaly) |
| `pg_up` (Postgres scraper) | 0 | critical |
| `redis_up` | 0 | critical |

Delivery: webhook to whatever on-call tool you already use. The
F.9 anomaly endpoint can serve as a cheap push target.

## Incident response

See `docs/incident-response.md` for the full step-by-step playbook.
Short form: pause LLM + sandbox, snapshot the DB, read audit_log,
rotate secrets if compromise is plausible, write a postmortem.
