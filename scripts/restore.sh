#!/usr/bin/env bash
# C-P0.8b: Career OS restore script.
#
# Reverses backup.sh: age-decrypts each artifact and hands it to the
# canonical restore tool for that datastore. Parity check runs at the end.
#
# Usage:
#   restore.sh --age-key <path> [--postgres <file.age>] [--minio <tar.age>]
#              [--qdrant <collection>=<snapshot.age> ...]
#
# All datastore flags are optional; restore runs for whichever are provided.
# --age-key is required whenever any encrypted artifact is passed.
#
# Env:
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE   standard libpq (PGDATABASE
#                                                defaults to "careeros")
#   MC_ALIAS                mc alias, default "minio"
#   MC_BUCKET               MinIO bucket, default "careeros"
#   QDRANT_URL              Qdrant base URL, default "http://qdrant:6333"
#   QDRANT_API_KEY          optional
#   LOG_FILE                default /var/log/careeros-restore.log
#
# Exit codes: 0 on full success, non-zero on any failure.
#
# ponytail: single file. If restore ever needs partial-per-table postgres
# selection, split into `packages/restore/` with per-datastore handlers.

set -euo pipefail

LOG_FILE="${LOG_FILE:-/var/log/careeros-restore.log}"
MC_ALIAS="${MC_ALIAS:-minio}"
MC_BUCKET="${MC_BUCKET:-careeros}"
QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
PGDATABASE="${PGDATABASE:-careeros}"

AGE_KEY=""
PG_FILE=""
MINIO_FILE=""
QDRANT_ARGS=()

log() {
  local line
  line="$(printf '%s [%s] %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1}" "${2}")"
  if [[ -w "$LOG_FILE" ]] || { [[ -d "$(dirname "$LOG_FILE")" ]] && touch "$LOG_FILE" 2>/dev/null; }; then
    printf '%s\n' "$line" | tee -a "$LOG_FILE" >&2
  else
    printf '%s\n' "$line" >&2
  fi
}
die() { log ERROR "$*"; exit 1; }
require_bin() { command -v "$1" >/dev/null 2>&1 || die "missing required binary: $1"; }

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --age-key)  AGE_KEY="${2:-}"; shift 2 ;;
    --postgres) PG_FILE="${2:-}"; shift 2 ;;
    --minio)    MINIO_FILE="${2:-}"; shift 2 ;;
    --qdrant)   QDRANT_ARGS+=("${2:-}"); shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown flag: $1 (see --help)" ;;
  esac
done

if [[ -z "$PG_FILE" && -z "$MINIO_FILE" && ${#QDRANT_ARGS[@]} -eq 0 ]]; then
  die "no restore targets. supply --postgres and/or --minio and/or --qdrant"
fi

if [[ -z "$AGE_KEY" ]]; then die "--age-key is required"; fi
[[ -r "$AGE_KEY" ]] || die "age key not readable: $AGE_KEY"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

require_bin age
if [[ -n "$PG_FILE"    ]]; then require_bin pg_restore; require_bin psql; fi
if [[ -n "$MINIO_FILE" ]]; then require_bin mc; require_bin tar; fi
if [[ ${#QDRANT_ARGS[@]} -gt 0 ]]; then require_bin curl; require_bin jq; fi

TMPDIR_R="$(mktemp -d -t careeros-restore-XXXXXX)"
trap 'rm -rf "$TMPDIR_R"' EXIT

log INFO "restore start pg=${PG_FILE:-none} minio=${MINIO_FILE:-none} qdrant_count=${#QDRANT_ARGS[@]}"

# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

restore_postgres() {
  local src="$1"
  [[ -r "$src" ]] || die "postgres backup not readable: $src"
  local dump="$TMPDIR_R/postgres.dump"
  log INFO "postgres decrypt $src -> $dump"
  age -d -i "$AGE_KEY" -o "$dump" "$src"

  log INFO "postgres restore db=$PGDATABASE"
  # --clean --if-exists drops objects before restore; --no-owner keeps this
  # portable across environments where the restore role differs.
  pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$dump"

  local rows
  rows="$(psql -tA -d "$PGDATABASE" -c 'SELECT count(*) FROM users' 2>/dev/null || echo unknown)"
  log INFO "postgres parity users_count=$rows"
}

# ---------------------------------------------------------------------------
# MinIO
# ---------------------------------------------------------------------------

restore_minio() {
  local src="$1"
  [[ -r "$src" ]] || die "minio backup not readable: $src"
  local tar_out="$TMPDIR_R/minio.tar.gz"
  local extract="$TMPDIR_R/minio"

  log INFO "minio decrypt $src"
  age -d -i "$AGE_KEY" -o "$tar_out" "$src"
  mkdir -p "$extract"
  tar -C "$extract" -xzf "$tar_out"

  log INFO "minio mirror -> $MC_ALIAS/$MC_BUCKET"
  mc mirror --overwrite --quiet "$extract/" "$MC_ALIAS/$MC_BUCKET"

  local count
  count="$(mc ls --recursive "$MC_ALIAS/$MC_BUCKET" 2>/dev/null | wc -l | tr -d ' ')"
  log INFO "minio parity object_count=$count"
}

# ---------------------------------------------------------------------------
# Qdrant
# ---------------------------------------------------------------------------

qdrant_curl() {
  if [[ -n "${QDRANT_API_KEY:-}" ]]; then
    curl -fsS --header "api-key: $QDRANT_API_KEY" "$@"
  else
    curl -fsS "$@"
  fi
}

restore_qdrant() {
  # Arg: "collection=snapshot.age"
  local spec="$1"
  local name="${spec%%=*}"
  local src="${spec#*=}"
  [[ -n "$name" && "$name" != "$src" ]] || die "qdrant arg must be name=path.age (got: $spec)"
  [[ -r "$src" ]] || die "qdrant snapshot not readable: $src"

  local plain="$TMPDIR_R/qdrant-$name.snapshot"
  log INFO "qdrant decrypt collection=$name $src"
  age -d -i "$AGE_KEY" -o "$plain" "$src"

  # Documented upload endpoint: POST multipart form to
  # /collections/{name}/snapshots/upload with `snapshot` file field.
  log INFO "qdrant upload collection=$name"
  local resp
  resp="$(qdrant_curl -X POST "$QDRANT_URL/collections/$name/snapshots/upload?priority=snapshot" \
    -F "snapshot=@${plain}")"
  local status
  status="$(printf '%s' "$resp" | jq -r '.status // "ok"')"
  if [[ "$status" != "ok" ]]; then
    die "qdrant upload failed collection=$name resp=$resp"
  fi

  local points
  points="$(qdrant_curl "$QDRANT_URL/collections/$name" \
    | jq -r '.result.points_count // "unknown"')"
  log INFO "qdrant parity collection=$name points_count=$points"
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

FAIL=0

if [[ -n "$PG_FILE" ]]; then
  restore_postgres "$PG_FILE" || { log ERROR "postgres restore failed"; FAIL=1; }
fi
if [[ -n "$MINIO_FILE" ]]; then
  restore_minio "$MINIO_FILE" || { log ERROR "minio restore failed"; FAIL=1; }
fi
if [[ ${#QDRANT_ARGS[@]} -gt 0 ]]; then
  for spec in "${QDRANT_ARGS[@]}"; do
    restore_qdrant "$spec" || { log ERROR "qdrant restore failed spec=$spec"; FAIL=1; }
  done
fi

if (( FAIL != 0 )); then
  log ERROR "restore finished with errors"
  exit 1
fi
log INFO "restore complete"
exit 0
