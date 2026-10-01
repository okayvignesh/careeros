# Backup and restore

Career OS ships a self-hosted backup story with three parts: `scripts/backup.sh`
snapshots Postgres, MinIO, and Qdrant; every artifact is encrypted with
[age](https://age-encryption.org) using your public key; and
`scripts/restore.sh` reverses the process with a small parity check at the
end.

Related spec: `plan/security.md` item 8 and `plan/phase-0-install.md` lines
243 to 250.

## What you need

Install once on the host that runs the compose stack:

| Tool       | Why                              |
|------------|----------------------------------|
| `age`      | Encrypts and decrypts artifacts. |
| `pg_dump`  | Postgres logical dump (custom format). |
| `mc`       | MinIO client for `mirror`.       |
| `curl`     | Qdrant snapshot API.             |
| `jq`       | Parses the Qdrant response.      |
| `tar`, `gzip`, coreutils | Standard.               |

On Ubuntu 24.04: `apt install age postgresql-client-16 curl jq tar` plus the
[mc binary](https://min.io/docs/minio/linux/reference/minio-mc.html) from
MinIO's release page (single static binary; put it in `/usr/local/bin`).

## Generate the age key

Run this ONCE on a trusted machine (ideally not the VPS itself):

```
age-keygen -o careeros-backup.key
```

The command writes two things: the private key (in the file) and the public
recipient (echoed to stdout, format `age1...`). Copy the recipient string;
you will need it every backup run. Keep the file safe: with the file anyone
can decrypt your backups, without it no one can, including you.

## Where to store the key

- Off the host being backed up. A backup and its key together defeat the
  point of encryption.
- Encrypted at rest. Put it in a password manager (1Password, Bitwarden,
  KeePass) or a hardware token (YubiKey PIV).
- Redundantly. Two separate encrypted stores. One-copy is no-copy.
- NEVER commit the key. `.gitignore` already excludes `*.key`, but treat it
  the way you treat root SSH keys.

Rotation: `age` supports adding a second recipient. Generate a new key,
re-encrypt the latest few backups against the new recipient, and retire the
old key. There is no cron for this yet; it is an operator task (tracked as
a `G-Ops` gap for post-1.0).

## Running a backup by hand

```
export AGE_RECIPIENT=age1abcdef...
export PGUSER=careeros
export PGPASSWORD=...      # or use ~/.pgpass
export PGHOST=127.0.0.1
export BACKUP_DIR=/var/backups/careeros

./scripts/backup.sh
```

Output: one file per datastore in `$BACKUP_DIR`:

- `postgres-YYYYMMDD-HHMMSS.dump.age`
- `minio-YYYYMMDD-HHMMSS.tar.gz.age`
- `qdrant-<collection>-YYYYMMDD-HHMMSS.snapshot.age` (one per collection)

Plus retention symlinks: `daily-1.dump.age`, `weekly-1.dump.age`, and so on.

The final line printed to stdout is the summary:

```
careeros-backup ok stamp=20260927-034512 pg=132480 minio=1048576 qdrant=2048 total=1183104
```

The log file (`$BACKUP_DIR/backup.log` by default) has full timestamped
history.

## Cron entry

Put an env file at `/etc/careeros/backup.env` (root:root, mode 0600) with
every required variable:

```
AGE_RECIPIENT=age1abcdef...
BACKUP_DIR=/var/backups/careeros
PGHOST=127.0.0.1
PGUSER=careeros
PGPASSWORD=...
PGDATABASE=careeros
MC_ALIAS=minio
MC_BUCKET=careeros
QDRANT_URL=http://127.0.0.1:6333
```

Then edit the operator's crontab (`crontab -e`) and add:

```
17 3 * * * /opt/careeros/scripts/backup-cron.sh
```

`backup-cron.sh` reads that env file, invokes `backup.sh`, and writes the
summary line to `/var/log/careeros-backup.log`. If cron has `MAILTO=` set,
you also get an email with the summary or the failure line.

`mc` needs its alias pre-configured (`mc alias set minio http://127.0.0.1:9000
$MINIO_ROOT_USER $MINIO_ROOT_PASSWORD`); this is a one-time operator step.

## Retention policy

Three tiers, tracked via symlinks in `$BACKUP_DIR`:

| Tier    | Keep | Symlinks                       |
|---------|------|--------------------------------|
| Daily   | 7    | `daily-1..7-<prefix>.<suffix>` |
| Weekly  | 4    | `weekly-1..4-<prefix>.<suffix>`|
| Monthly | 12   | `monthly-1..12-<prefix>.<suffix>` |

Underlying files past the daily+weekly+monthly union (23 per prefix) are
deleted only if no symlink still points at them. Symlinks that pin a file
across tiers protect that file from pruning; the file survives until every
pinning symlink rotates off it.

## Restore quick recipe

Recover the latest daily Postgres and MinIO onto a fresh compose stack:

```
export PGHOST=127.0.0.1 PGUSER=careeros PGPASSWORD=... PGDATABASE=careeros

./scripts/restore.sh \
  --age-key /path/to/careeros-backup.key \
  --postgres $BACKUP_DIR/daily-1-postgres.dump.age \
  --minio    $BACKUP_DIR/daily-1-minio.tar.gz.age \
  --qdrant   resumes=$BACKUP_DIR/daily-1-qdrant-resumes.snapshot.age \
  --qdrant   jobs=$BACKUP_DIR/daily-1-qdrant-jobs.snapshot.age
```

All flags are optional. Provide only the datastores you want to restore.
`--age-key` is always required.

At the end, the script logs a parity line per datastore: users row count,
MinIO object count, Qdrant points count. Cross-check against the source
system.

## RPO and RTO

Career OS targets a 24 hour Recovery Point Objective and a 2 hour Recovery
Time Objective, measured end to end from the operator typing the restore
command to the API answering `setup_state=complete` on a fresh host.

- **RPO = 24h.** `scripts/backup-cron.sh` runs once per day (cron slot
  `17 3 * * *` in the sample above). Every run writes a full snapshot of
  Postgres plus MinIO plus Qdrant, encrypted with `age` before leaving the
  host. Worst case data loss between runs is one calendar day; recovery
  always lands on a daily artifact, never a partial.
- **RTO = 2h.** `scripts/restore.sh` is the single command path: decrypt,
  `pg_restore -c`, `mc mirror`, Qdrant snapshot upload, parity check. On a
  5 GB compressed dump the Postgres restore dominates and finishes in minutes
  on modern hardware; the two hour budget covers VPS provisioning, image
  pulls, env wiring, and the parity check.
- **Retention keeps both honest.** The 7 daily / 4 weekly / 12 monthly
  symlink tiers in `$BACKUP_DIR` mean the operator always has at least one
  artifact younger than 24h, four artifacts spanning a month, and twelve
  spanning a year; a corrupt or truncated nightly does not become the only
  restore source.
- **Drill cadence.**
  - Automated: `.github/workflows/restore-test.yml` runs weekly (Mondays
    03:00 UTC) on fresh Docker volumes, restores the latest artifacts,
    boots the API, and asserts `setup_state=complete` plus row-count
    parity via `scripts/verify-restore-parity.sh`. A red run opens a
    tracking issue via the test-failure-autofile workflow.
  - Manual: quarterly, run the "Verifying backups" recipe below on a
    throwaway host. Record the measured restore wall-clock in the ops log;
    if it ever exceeds the 2h RTO, open a `G-Ops` ticket to shrink the
    dataset or move to a faster destination.
- **What breaks the budget.** `ENCRYPTION_KEY` is deliberately NOT in the
  backup (security.md item 8). Lose the operator's `age` private key and
  the backup is unrecoverable; the RTO assumes the key is already in a
  password manager or hardware token per "Where to store the key" above.

## Off-site copy (sample, not implemented)

The scripts above write to a local directory. For an off-site copy, tack a
second job onto the same cron slot to `rsync` `$BACKUP_DIR` to Backblaze B2
using `rclone`:

```
# Example only; adapt paths and remote name.
32 3 * * * /usr/bin/rclone sync /var/backups/careeros b2:careeros-backups \
  --transfers=4 --checkers=8 --log-file=/var/log/careeros-b2.log
```

Backblaze B2 is the default recommendation because it is S3-compatible,
cheap, and has no egress fee tier that makes restore prohibitive. Any
S3-compatible target (Wasabi, MinIO on a second box, plain S3) works.

The off-site copy is deliberately not scripted in-repo: the choice of
destination is operator policy. A future release (Wave F.7) will bundle a
CI restore test that pulls from whichever destination the operator picked.

## Verifying backups

Once a quarter, run the restore against a throwaway stack. The `scripts/`
folder does not ship a full "restore drill" script yet (tracked as G-Ops).
The manual recipe:

1. `docker compose down -v` on a scratch host.
2. `docker compose up -d postgres minio qdrant`.
3. Run `scripts/restore.sh` with the latest three artifacts.
4. Boot the API; sign in; confirm the row counts match.

If any step fails, treat it like a security incident (see
`docs/incident-response.md` once that lands).
