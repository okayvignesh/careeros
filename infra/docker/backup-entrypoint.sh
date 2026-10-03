#!/bin/sh
# Backup sidecar entrypoint.
#
# 1. Fail loudly if AGE_RECIPIENT is missing (backups must never silently
#    write plaintext or quietly no-op).
# 2. Render /etc/careeros/backup.env from the container environment; compose
#    populates that environment from .env, so no secrets are invented here.
#    backup-cron.sh sources this file because crond starts jobs with a minimal
#    environment.
# 3. Configure the mc alias via argv (mc URL-parses MC_HOST_* values, which
#    mangles base64 secrets that contain '+' or '/').
# 4. Install the cron line and run crond in the foreground.
set -eu

if [ -z "${AGE_RECIPIENT:-}" ]; then
  echo "backup: AGE_RECIPIENT is required (set it in .env; see docs/backup.md)" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/careeros}"
MC_ALIAS="${MC_ALIAS:-minio}"

umask 077
mkdir -p /etc/careeros
cat > /etc/careeros/backup.env <<EOF
AGE_RECIPIENT=$AGE_RECIPIENT
BACKUP_DIR=$BACKUP_DIR
LOG_FILE=${LOG_FILE:-$BACKUP_DIR/careeros-backup.log}
HOME=/root
PGHOST=${PGHOST:-postgres}
PGPORT=${PGPORT:-5432}
PGUSER=${PGUSER:?PGUSER is required}
PGPASSWORD=${PGPASSWORD:?PGPASSWORD is required}
PGDATABASE=${PGDATABASE:-careeros}
MC_ALIAS=$MC_ALIAS
MC_BUCKET=${MC_BUCKET:-careeros}
QDRANT_URL=${QDRANT_URL:-http://qdrant:6333}
BACKUP_EXIT_ON_QDRANT_EMPTY=${BACKUP_EXIT_ON_QDRANT_EMPTY:-0}
EOF

# Idempotent: re-set on every container start. Silence first-boot failures if
# MinIO is still warming up; the scheduled run will have a live alias by then.
mc alias set "$MC_ALIAS" "${MINIO_ENDPOINT:-http://minio:9000}" \
  "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null 2>&1 || true

printf '%s /opt/careeros/scripts/backup-cron.sh\n' "${BACKUP_CRON_SCHEDULE:-17 3 * * *}" > /etc/crontabs/root

echo "backup: scheduled '${BACKUP_CRON_SCHEDULE:-17 3 * * *}' -> $BACKUP_DIR (log: ${LOG_FILE:-$BACKUP_DIR/careeros-backup.log})"
exec crond -f -l 2 -c /etc/crontabs
