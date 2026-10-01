#!/usr/bin/env bash
# testing.md item 7 + security.md item 8:
#   - Byte-inspection: the postgres artifact scripts/backup.sh writes must
#     begin with the age v1 header AND must NOT be readable as plaintext
#     pg_dump output (PGDMP magic, SQL keywords).
#   - Encryption-key exclusion: ENCRYPTION_KEY env var is set to a known
#     distinctive sentinel before the backup runs. The decrypted dump must
#     NOT contain that sentinel, and no filename in BACKUP_DIR may contain
#     the string "ENCRYPTION_KEY" either.
#
# Companion to scripts/smoke/restore-age-wrong-key.sh (which proves the
# restore side refuses the wrong key). This one proves the backup side
# produces real ciphertext against a real postgres and does not accidentally
# serialize the master key.
#
# Guards (mirrors restore-age-wrong-key.sh + me.storage.integration.test.ts):
#   - requires `age`, `age-keygen`, `docker`, `pg_dump`. Skips cleanly otherwise.
#   - spins its own throwaway postgres container (no compose stack needed).
#
# Exits 0 on all assertions passing, 1 otherwise.
#
# ponytail: single file. If a second datastore ever needs the same
# inspection (minio/qdrant), promote the common header-check into a tiny
# helper. Postgres is the sensitive one (contains encrypted field blobs),
# so this covers it today.

set -euo pipefail

skip() { echo "SKIP: $*" >&2; exit 0; }

command -v age >/dev/null         || skip "age binary not installed."
command -v age-keygen >/dev/null  || skip "age-keygen not installed."
command -v docker >/dev/null      || skip "docker not installed."
command -v pg_dump >/dev/null     || skip "pg_dump not installed."
docker info >/dev/null 2>&1       || skip "docker daemon not reachable."

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_SCRIPT="$ROOT/scripts/backup.sh"
[[ -x "$BACKUP_SCRIPT" ]] || { echo "FAIL: $BACKUP_SCRIPT not executable." >&2; exit 1; }

TMPDIR="$(mktemp -d)"
PG_CID=""
cleanup() {
  if [[ -n "$PG_CID" ]]; then docker rm -f "$PG_CID" >/dev/null 2>&1 || true; fi
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# --- 1. keypair ----------------------------------------------------------
KEY="$TMPDIR/key.txt"
age-keygen -o "$KEY" 2>/dev/null
RECIPIENT="$(grep '^# public key:' "$KEY" | sed 's/^# public key: //')"
[[ -n "$RECIPIENT" ]] || { echo "FAIL: no recipient parsed from age-keygen." >&2; exit 1; }

# --- 2. throwaway postgres ----------------------------------------------
PG_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])' 2>/dev/null \
  || node -e 'const s=require("net").createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})')"
PG_CID="$(docker run -d --rm \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_USER=test \
  -e POSTGRES_DB=careeros \
  -p "$PG_PORT:5432" \
  postgres:16-alpine)"

# Wait for pg ready (max 30s).
for _ in $(seq 1 60); do
  if docker exec "$PG_CID" pg_isready -U test -d careeros >/dev/null 2>&1; then break; fi
  sleep 0.5
done
docker exec "$PG_CID" pg_isready -U test -d careeros >/dev/null 2>&1 \
  || { echo "FAIL: postgres never became ready." >&2; exit 1; }

# Seed a tiny row so pg_dump has real content to encrypt. The row text is a
# unique sentinel we also assert survives the decrypt (sanity: we really
# dumped something) and does NOT equal the ENCRYPTION_KEY sentinel below.
PGPASSWORD=test psql -h 127.0.0.1 -p "$PG_PORT" -U test -d careeros \
  -c "CREATE TABLE smoke (payload text); INSERT INTO smoke VALUES ('careeros-smoke-row-marker');" \
  >/dev/null

# --- 3. run backup.sh with a distinctive ENCRYPTION_KEY sentinel --------
# The sentinel is 64 hex chars (valid shape per packages/secrets/master-key.ts)
# and contains a stable string we can grep for. If backup.sh ever accidentally
# serializes the env, this value lands in the decrypted dump and the test fails.
ENCRYPTION_KEY="deadbeefcafebabe$(printf 'ENCRYPTIONKEYLEAKSENTINEL'| xxd -p -c 128)"
# Pad to exactly 64 hex chars (hex-encoded ASCII of SENTINEL = 48 chars + 16 prefix).
ENCRYPTION_KEY="${ENCRYPTION_KEY:0:64}"
export ENCRYPTION_KEY
# ponytail: ENCRYPTION_KEY shape only matters to apps that READ it; backup.sh
# never does. We export it anyway so this test proves that even if a future
# refactor pulls env snapshots into logs/metadata, the sentinel surfaces.

BACKUP_DIR="$TMPDIR/backups"
STAGING_DIR="$TMPDIR/staging"
LOG_FILE="$TMPDIR/backup.log"
mkdir -p "$BACKUP_DIR" "$STAGING_DIR"

# Call backup.sh with just postgres (skip minio+qdrant by making them no-op).
# backup.sh requires age + pg_dump + mc + tar + curl + jq + gzip at pre-flight.
# For mc/curl/jq/tar/gzip we rely on them being present on the dev box; this
# whole script is operator-smoke, so if they are missing we skip cleanly.
for bin in mc tar curl jq gzip; do
  command -v "$bin" >/dev/null || skip "backup.sh pre-flight needs $bin."
done

# `mc` wants an alias; point it at a dead endpoint so backup_minio errors
# gracefully. We treat the postgres artifact as the test target either way.
# AGE_RECIPIENT drives the encryption; backup.sh fails fast without it.
export AGE_RECIPIENT="$RECIPIENT"
export BACKUP_DIR STAGING_DIR LOG_FILE
export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=test PGPASSWORD=test PGDATABASE=careeros
export MC_ALIAS=nope MC_BUCKET=nope
export QDRANT_URL="http://127.0.0.1:1"
export BACKUP_EXIT_ON_QDRANT_EMPTY=0

# backup.sh may fail on minio/qdrant stages; we only need the postgres artifact
# to exist. `|| true` keeps us going; the explicit file check below is the
# real pass/fail.
"$BACKUP_SCRIPT" >/dev/null 2>&1 || true

PG_ARTIFACT="$(find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.dump.age' -type f | head -n 1)"
[[ -n "$PG_ARTIFACT" ]] || { echo "FAIL: backup.sh produced no postgres artifact." >&2; exit 1; }

# --- 4. byte-inspection: age header + not plaintext SQL -----------------
HEADER="$(head -c 22 "$PG_ARTIFACT" || true)"
[[ "$HEADER" == $'age-encryption.org/v1\n' ]] \
  || { echo "FAIL: artifact does not start with age v1 header. got: $(printf %q "$HEADER")" >&2; exit 1; }

# A pg_dump -Fc file begins with the magic bytes "PGDMP". A plaintext SQL
# dump would contain SQL keywords. Assert neither is visible in the raw
# ciphertext.
if head -c 4096 "$PG_ARTIFACT" | grep -q 'PGDMP'; then
  echo "FAIL: PGDMP magic found in ciphertext (dump written in the clear?)." >&2
  exit 1
fi
if head -c 4096 "$PG_ARTIFACT" | grep -qiE 'CREATE TABLE|INSERT INTO|SELECT |COPY '; then
  echo "FAIL: SQL keywords visible in ciphertext (dump written in the clear?)." >&2
  exit 1
fi

# --- 5. decrypt + ENCRYPTION_KEY exclusion ------------------------------
DECRYPTED="$TMPDIR/decrypted.dump"
age -d -i "$KEY" -o "$DECRYPTED" "$PG_ARTIFACT" \
  || { echo "FAIL: age -d failed on backup artifact." >&2; exit 1; }

# Sanity: the row we seeded is in the decrypted dump (proves we really dumped
# AND decrypted the real postgres content).
if ! grep -q 'careeros-smoke-row-marker' "$DECRYPTED"; then
  echo "FAIL: seeded sentinel row not present in decrypted dump." >&2
  exit 1
fi

# The ENCRYPTION_KEY sentinel must NOT appear anywhere in the decrypted dump.
if grep -q 'ENCRYPTIONKEYLEAKSENTINEL' "$DECRYPTED"; then
  echo "FAIL: ENCRYPTION_KEY value leaked into decrypted backup dump." >&2
  exit 1
fi
if grep -q "$ENCRYPTION_KEY" "$DECRYPTED"; then
  echo "FAIL: full ENCRYPTION_KEY string leaked into decrypted backup dump." >&2
  exit 1
fi

# No filename in BACKUP_DIR may contain the string "ENCRYPTION_KEY" (would
# imply a log/metadata file was named after the env var).
if find "$BACKUP_DIR" -name '*ENCRYPTION_KEY*' -print -quit | grep -q .; then
  echo "FAIL: filename in BACKUP_DIR references ENCRYPTION_KEY." >&2
  exit 1
fi

# Also check the log file for the sentinel (backup.sh logs env sometimes;
# this guards against a future `log INFO "env: $(env)"` regression).
if [[ -f "$LOG_FILE" ]] && grep -q 'ENCRYPTIONKEYLEAKSENTINEL' "$LOG_FILE"; then
  echo "FAIL: ENCRYPTION_KEY sentinel leaked into backup.log." >&2
  exit 1
fi

echo "ok: age v1 header present; no plaintext SQL visible; decrypt roundtrip;"
echo "ok: ENCRYPTION_KEY sentinel absent from dump, filenames, and log."
