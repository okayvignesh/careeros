#!/usr/bin/env bash
# C-P0.8a: cron wrapper for backup.sh.
#
# Suitable for a crontab line such as:
#   17 3 * * * /opt/careeros/scripts/backup-cron.sh
#
# Sources /etc/careeros/backup.env if present (place AGE_RECIPIENT, PGUSER,
# PGPASSWORD, MC_ALIAS wiring, etc. there so cron gets a clean environment).
# Emits a one-line summary to $LOG_FILE and echoes it so cron's MAILTO picks
# it up.
#
# ponytail: no retry loop. Cron re-runs tomorrow. If a nightly backup miss is
# operationally intolerable, add a systemd timer with `OnFailure=` instead.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${LOG_FILE:-/var/log/careeros-backup.log}"
ENV_FILE="${BACKUP_ENV_FILE:-/etc/careeros/backup.env}"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "---- careeros-backup run started=$STARTED"
} >> "$LOG_FILE"

# Run the backup; capture summary line from stdout and full stderr into the
# log. `set -o pipefail` propagates a backup.sh failure to the outer script.
if SUMMARY="$("$SCRIPT_DIR/backup.sh" 2>>"$LOG_FILE")"; then
  echo "$SUMMARY" | tee -a "$LOG_FILE"
  exit 0
else
  rc=$?
  echo "careeros-backup FAIL rc=$rc started=$STARTED (see $LOG_FILE)" | tee -a "$LOG_FILE"
  exit "$rc"
fi
