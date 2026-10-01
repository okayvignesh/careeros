# Incident response

Playbook for an operator responding to a security or availability
incident in Career OS. Written assuming you are alone - no on-call
rotation. Err on the side of over-pausing rather than keeping an
unknown-state system live.

## Severity ladder

| Severity | Example | Response SLO |
|---|---|---|
| **P1** | Secrets exfiltration, account takeover, data loss, backup chain broken | act within 1h |
| **P2** | Service down, backup missed, repeated 5xx on health | act within 4h |
| **P3** | Degraded (slow, intermittent errors), elevated cost | act within 24h |
| **P4** | Minor UI glitch, warnings in logs | triage next week |

## Immediate actions (every incident)

1. **Stop the bleeding.** Pause what might be writing out:
   ```bash
   curl -X POST https://<host>/me/usage/pause  -d '{"paused":true}' -b 'session=...' -H 'content-type: application/json'
   curl -X POST https://<host>/admin/sandbox/pause -b 'session=...'
   ```
2. **Snapshot state.** You will want this later even if the incident
   turns out to be nothing:
   ```bash
   DATE=$(date -u +%Y%m%d-%H%M%S)
   docker compose exec postgres pg_dump $DATABASE_URL \
     > /var/lib/careeros/snapshots/incident-$DATE.sql
   docker compose logs --since 24h > /var/lib/careeros/snapshots/logs-$DATE.txt
   ```
3. **Open a scratch doc** with timestamps. Even if it is just a text
   file. Memory of a 2am incident is terrible.

## Triage tree

### Suspected credential compromise

Signs: unknown IP in `audit_events` for `auth.login.ok`, passkey
registration you didn't make, device paired you don't recognise.

1. Revoke all active sessions:
   ```sql
   DELETE FROM active_sessions;
   ```
2. Revoke every paired agent device:
   ```sql
   UPDATE agent_devices SET revoked_at = NOW() WHERE revoked_at IS NULL;
   DELETE FROM agent_sessions;
   ```
3. Change your password (`POST /auth/password/change`) + re-enrol
   passkey.
4. Rotate every integration secret: GitHub PAT, GitLab PAT, Slack
   bot token (re-install app), Gmail OAuth (revoke in Google console,
   re-run OAuth flow), LLM API key.
5. Review `audit_events` for the window around the first unknown
   action; export via `POST /me/export`.
6. Write a postmortem (see template).

### Suspected secret-store compromise

Signs: `encrypted_secrets` rows missing or mutated outside app code,
unauthorized access to the host.

1. Rotate `MASTER_KEY` per the runbook procedure. Every
   encrypted_secrets row is bound to the old key via AAD so a stolen
   ciphertext is useless without the key.
2. Revoke every integration token at the SOURCE (GitHub, GitLab,
   Google, Slack, LLM provider dashboards). Encrypted-at-rest is
   NOT sufficient if the attacker had host root; assume plaintext
   leak.
3. Re-run the OAuth flows + paste in fresh PATs.
4. Audit the host: SSH keys, sudoers, ssh_logs, running processes,
   `last` output.

### Backup chain broken

Signs: Monday restore-test workflow is red, or
`backup_last_success_seconds_ago > 48h`.

1. Verify the backup script runs: `bash scripts/backup.sh --verbose`.
   Common causes: `age` recipient key expired, destination credential
   rotated, disk full on destination.
2. Run `scripts/restore.sh --dry-run` against the last known-good
   backup to confirm it is actually restorable.
3. If no restorable backup exists in the last 72h, treat as **P1**:
   trigger an immediate manual backup, verify, then schedule a
   restore drill on a scratch host.

### Service down / health failing

1. `docker compose ps` + `docker compose logs api web` - find the
   failing container.
2. Check disk space (`df -h`), Postgres connection count
   (`SELECT count(*) FROM pg_stat_activity`), Redis memory.
3. If Postgres is OOM / full, pause + archive old audit log rows
   (`DELETE FROM audit_events WHERE timestamp < NOW() - interval '1 year'`
   via the retention worker; see `docs/audit-log.md`).
4. Restart: `docker compose restart api`.
5. If a bad migration is the cause, write a NEW migration that
   reverts the change. Never `migrate reset` in prod.

### Cost spike (LLM budget blown)

Signs: `/me/usage/anomaly` returns `severity: critical`, Prometheus
alert on `llm_calls_total`.

1. Pause LLM calls (step 1 of every incident).
2. Look at `/me/usage/cost-projection?window=7d` + `.../calls?errorsOnly=1`.
3. Common cause: a prompt retry loop with no `max_tokens` cap or a
   test harness that ran against prod. Find the originating `promptId`
   via `audit_events`.
4. Fix the loop + redeploy.
5. Decide: lower monthly budget, add a per-call token cap, or both.

## Comms

Single-user tool, so this is just for yourself + anyone you'd want
to tell about the incident. For OSS release:

- If user data of OTHER operators is at risk (not just your own),
  publish a security advisory via GitHub Security Advisories within
  7 days.
- Credit the reporter per `SECURITY.md`.

## Postmortem

After the fix lands, write a postmortem using
`docs/postmortem-template.md`. The point is not blame; it is the
"what are we changing so the next time is better" list.

File it under `docs/postmortems/YYYY-MM-DD-<short-title>.md`.
