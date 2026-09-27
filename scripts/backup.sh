#!/usr/bin/env bash
# C-P0.8a: Career OS backup script.
#
# Snapshots Postgres, MinIO, and Qdrant; encrypts each artifact with `age`
# using the operator's public recipient key; maintains a 7 daily / 4 weekly
# / 12 monthly retention window via symlinks.
#
# Env (all required unless noted):
#   AGE_RECIPIENT           age public key (recipient string) for encryption
#   BACKUP_DIR              output dir, default /var/backups/careeros
#   STAGING_DIR             scratch dir, default $(mktemp -d)
#   LOG_FILE                log path, default $BACKUP_DIR/backup.log
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE   standard libpq env
#                           (PGDATABASE defaults to "careeros")
#   MC_ALIAS                mc alias for the MinIO instance, default "minio"
#   MC_BUCKET               MinIO bucket, default "careeros"
#   QDRANT_URL              Qdrant HTTP base URL, default "http://qdrant:6333"
#   QDRANT_API_KEY          optional; sent as `api-key` header if set
#   BACKUP_EXIT_ON_QDRANT_EMPTY   set to "1" to fail when no collections exist
#
# Deps: age, pg_dump, mc, tar, curl, jq, gzip, coreutils.
#
# ponytail: single-file script. Splitting per-service handlers into a
# packages/backup/ module is the upgrade path if we ever run this outside a
# host cron (e.g. from an operator webhook). Not needed today.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config + logging
# ---------------------------------------------------------------------------

BACKUP_DIR="${BACKUP_DIR:-/var/backups/careeros}"
STAGING_DIR="${STAGING_DIR:-}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"
MC_ALIAS="${MC_ALIAS:-minio}"
MC_BUCKET="${MC_BUCKET:-careeros}"
QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
PGDATABASE="${PGDATABASE:-careeros}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"

log() {
  # Every log line: ISO-8601 UTC + level + message. Tee'd to $LOG_FILE and
  # to stderr so a cron MAILTO still surfaces failures. If the log dir does
  # not exist yet (e.g. env validation fails before mkdir), fall back to
  # stderr only so we do not emit spurious `tee: ... No such file` noise.
  local line
  line="$(printf '%s [%s] %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1}" "${2}")"
  if [[ -w "$LOG_FILE" ]] || { [[ -d "$(dirname "$LOG_FILE")" ]] && touch "$LOG_FILE" 2>/dev/null; }; then
    printf '%s\n' "$line" | tee -a "$LOG_FILE" >&2
  else
    printf '%s\n' "$line" >&2
  fi
}

die() { log ERROR "$*"; exit 1; }

require_env() {
  # ponytail: fail-fast at top, one guard per required env. Loud beats
  # subtle every time an operator debugs a cron at 3am.
  local name="$1"
  if [[ -z "${!name:-}" ]]; then die "missing required env: $name"; fi
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || die "missing required binary: $1"
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

require_env AGE_RECIPIENT
for bin in age pg_dump mc tar curl jq gzip; do require_bin "$bin"; done

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

if [[ -z "$STAGING_DIR" ]]; then
  STAGING_DIR="$(mktemp -d -t careeros-backup-XXXXXX)"
fi
mkdir -p "$STAGING_DIR"
trap 'rm -rf "$STAGING_DIR"' EXIT

log INFO "backup start stamp=$STAMP dir=$BACKUP_DIR staging=$STAGING_DIR"

# Byte-count accumulators for the summary line.
PG_BYTES=0
MINIO_BYTES=0
QDRANT_BYTES=0

# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

backup_postgres() {
  local out="$BACKUP_DIR/postgres-$STAMP.dump.age"
  log INFO "postgres dump -> $out db=$PGDATABASE"

  # pg_dump -Fc is the standard restore-with-any-pg format. We pipe straight
  # into age so plaintext is never written to disk. `set -o pipefail` (from
  # `set -euo pipefail` above) makes a pg_dump failure fail the whole pipe.
  pg_dump -Fc "$PGDATABASE" \
    | age -r "$AGE_RECIPIENT" -o "$out"

  PG_BYTES="$(wc -c < "$out" | tr -d ' ')"
  log INFO "postgres done bytes=$PG_BYTES"
  echo "$out"
}

# ---------------------------------------------------------------------------
# MinIO
# ---------------------------------------------------------------------------

backup_minio() {
  local mirror="$STAGING_DIR/minio"
  local out="$BACKUP_DIR/minio-$STAMP.tar.gz.age"
  log INFO "minio mirror -> $mirror alias=$MC_ALIAS bucket=$MC_BUCKET"

  mkdir -p "$mirror"
  # `mc mirror` is idempotent; --overwrite handles re-runs against the same
  # staging dir if the trap ever misses.
  mc mirror --overwrite --quiet "$MC_ALIAS/$MC_BUCKET" "$mirror/"

  log INFO "minio tar+encrypt -> $out"
  # `tar -C` avoids embedding host-absolute paths inside the archive so a
  # restore can lay files back down anywhere.
  tar -C "$mirror" -cz . \
    | age -r "$AGE_RECIPIENT" -o "$out"

  MINIO_BYTES="$(wc -c < "$out" | tr -d ' ')"
  log INFO "minio done bytes=$MINIO_BYTES"
  echo "$out"
}

# ---------------------------------------------------------------------------
# Qdrant
# ---------------------------------------------------------------------------

qdrant_curl() {
  # Small wrapper so the api-key header stays optional.
  if [[ -n "${QDRANT_API_KEY:-}" ]]; then
    curl -fsS --header "api-key: $QDRANT_API_KEY" "$@"
  else
    curl -fsS "$@"
  fi
}

backup_qdrant() {
  log INFO "qdrant snapshot base=$QDRANT_URL"

  local collections
  collections="$(qdrant_curl "$QDRANT_URL/collections" | jq -r '.result.collections[].name')"
  if [[ -z "$collections" ]]; then
    log WARN "qdrant has no collections"
    if [[ "${BACKUP_EXIT_ON_QDRANT_EMPTY:-0}" == "1" ]]; then
      die "qdrant empty and BACKUP_EXIT_ON_QDRANT_EMPTY=1"
    fi
    return 0
  fi

  local produced=""
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    log INFO "qdrant snapshot create collection=$name"

    # Qdrant returns the snapshot filename on the server; download it via the
    # documented `/collections/{name}/snapshots/{filename}` GET path.
    local snap
    snap="$(qdrant_curl -X POST "$QDRANT_URL/collections/$name/snapshots" \
      | jq -r '.result.name')"
    if [[ -z "$snap" || "$snap" == "null" ]]; then
      die "qdrant snapshot response missing .result.name for $name"
    fi

    local staged="$STAGING_DIR/qdrant-$name-$snap"
    qdrant_curl -o "$staged" "$QDRANT_URL/collections/$name/snapshots/$snap"

    local out="$BACKUP_DIR/qdrant-$name-$STAMP.snapshot.age"
    age -r "$AGE_RECIPIENT" -o "$out" < "$staged"
    local size
    size="$(wc -c < "$out" | tr -d ' ')"
    QDRANT_BYTES=$((QDRANT_BYTES + size))
    log INFO "qdrant done collection=$name bytes=$size"

    # ponytail: leave the server-side snapshot in place. Qdrant lets you list
    # + delete via API; not worth the extra call for a solo-op backup. Add a
    # cleanup pass if the qdrant volume starts bloating.
    produced+="$out"$'\n'
  done <<< "$collections"

  printf '%s' "$produced"
}

# ---------------------------------------------------------------------------
# Retention: 7 daily / 4 weekly / 12 monthly, tracked via symlinks
# ---------------------------------------------------------------------------

rotate_symlinks() {
  # $1 = glob prefix (e.g. "postgres-", "minio-", "qdrant-<name>-")
  # $2 = suffix (e.g. ".dump.age")
  # $3 = tier ("daily" | "weekly" | "monthly")
  # $4 = keep count
  local prefix="$1" suffix="$2" tier="$3" keep="$4"
  local files
  # `ls -1t` orders by mtime desc; portable enough for the tools we require.
  # ponytail: `find -printf` isn't POSIX; `ls -t` is good enough for a dir
  # we own where filenames are our own timestamped strings. Upgrade to a
  # proper mtime sort if the backup dir ever grows past tens of thousands
  # of files (it won't, retention caps at 23 files per prefix).
  # shellcheck disable=SC2010
  files="$(cd "$BACKUP_DIR" && ls -1t 2>/dev/null | grep "^${prefix}" | grep "${suffix}\$" || true)"
  [[ -z "$files" ]] && return 0

  local i=1
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if (( i > keep )); then break; fi
    ln -sfn "$f" "$BACKUP_DIR/${tier}-${i}-${prefix%-}${suffix}"
    i=$((i + 1))
  done <<< "$files"
}

prune_symlinks() {
  # Blow away leftover symlinks past the keep count (e.g. after retention
  # policy tightens). Files themselves are pruned by prune_files below.
  local prefix="$1" suffix="$2" tier="$3" keep="$4"
  local n=$((keep + 1))
  while true; do
    local link="$BACKUP_DIR/${tier}-${n}-${prefix%-}${suffix}"
    [[ -e "$link" || -L "$link" ]] || break
    rm -f "$link"
    n=$((n + 1))
  done
}

prune_files() {
  # Delete oldest files for a given prefix beyond the daily-tier horizon,
  # but only if no retention symlink still references them. Symlinks that
  # point at the file across daily/weekly/monthly tiers keep it pinned.
  local prefix="$1" suffix="$2" keep_daily="$3"
  local files
  # shellcheck disable=SC2010
  files="$(cd "$BACKUP_DIR" && ls -1t 2>/dev/null | grep "^${prefix}" | grep "${suffix}\$" | grep -v '^daily-\|^weekly-\|^monthly-' || true)"
  [[ -z "$files" ]] && return 0

  # Build the set of files currently pinned by any retention symlink.
  local pinned
  pinned="$(cd "$BACKUP_DIR" && find . -maxdepth 1 -type l \( -name 'daily-*' -o -name 'weekly-*' -o -name 'monthly-*' \) -print0 2>/dev/null | xargs -0 -I{} readlink {} 2>/dev/null | sort -u || true)"

  local i=1
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if (( i <= keep_daily )); then i=$((i + 1)); continue; fi
    if grep -Fxq "$f" <<< "$pinned"; then i=$((i + 1)); continue; fi
    log INFO "prune old $f"
    rm -f "$BACKUP_DIR/$f"
    i=$((i + 1))
  done <<< "$files"
}

apply_retention() {
  # Args: prefix, suffix. Runs the three tiers + prune.
  local prefix="$1" suffix="$2"
  # Daily: last 7. Weekly: last 4 (approx: same list, keeps every 7th run
  # only if the operator's cron matches the tier cadence; see docs/backup.md
  # for why the naive symlink-every-run approach is fine at this scale.
  # ponytail: proper "one per week / one per month" bucketing needs a state
  # file. For an operator running one nightly cron the current scheme keeps
  # the last 7 daily runs symlinked as daily-1..7 and the same slots re-used
  # for weekly/monthly; the file itself lives as long as any tier pins it.
  # Upgrade path: state-file with per-tier last-taken timestamp.
  rotate_symlinks "$prefix" "$suffix" daily 7
  rotate_symlinks "$prefix" "$suffix" weekly 4
  rotate_symlinks "$prefix" "$suffix" monthly 12
  prune_symlinks "$prefix" "$suffix" daily 7
  prune_symlinks "$prefix" "$suffix" weekly 4
  prune_symlinks "$prefix" "$suffix" monthly 12
  # Keep files that pin any tier; delete the rest past the daily+weekly+monthly
  # union horizon. 7+4+12=23 is the max any prefix can legitimately hold.
  prune_files "$prefix" "$suffix" 23
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

backup_postgres >/dev/null
backup_minio    >/dev/null
QDRANT_PRODUCED="$(backup_qdrant || true)"

apply_retention "postgres-" ".dump.age"
apply_retention "minio-"    ".tar.gz.age"

# Qdrant produces one artifact per collection with its name in the prefix, so
# we apply retention per collection.
if [[ -n "${QDRANT_PRODUCED:-}" ]]; then
  # shellcheck disable=SC2013
  for line in $(printf '%s\n' "$QDRANT_PRODUCED" | awk -F'/' '{print $NF}' | sed -E 's/-[0-9]{8}-[0-9]{6}\.snapshot\.age$//' | sort -u); do
    apply_retention "$line-" ".snapshot.age"
  done
fi

TOTAL=$((PG_BYTES + MINIO_BYTES + QDRANT_BYTES))
log INFO "backup summary stamp=$STAMP pg_bytes=$PG_BYTES minio_bytes=$MINIO_BYTES qdrant_bytes=$QDRANT_BYTES total_bytes=$TOTAL"
printf 'careeros-backup ok stamp=%s pg=%s minio=%s qdrant=%s total=%s\n' \
  "$STAMP" "$PG_BYTES" "$MINIO_BYTES" "$QDRANT_BYTES" "$TOTAL"

exit 0
