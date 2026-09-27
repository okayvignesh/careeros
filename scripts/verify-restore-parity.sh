#!/usr/bin/env bash
# C-P0.5b helper: assert row-count parity between a pre-backup manifest
# and the restored database. Consumed by .github/workflows/restore-test.yml.
#
# Contract:
#   1. Before backup, caller writes a manifest at $MANIFEST_PATH shaped as
#      "<schema>.<table> <row_count>" per line (whitespace-separated).
#   2. After restore, this script re-queries the live Postgres and diffs.
#
# Env:
#   PGURL          libpq connection URL of the RESTORED database
#   MANIFEST_PATH  path to the pre-backup manifest (default: /tmp/parity.manifest)
#
# Exit: 0 on parity, 1 on any mismatch or missing table.
# ponytail: awk-driven diff, no jq/psql-fanciness. Upgrade to per-row checksum
# if row-count parity ever passes but content diverges.

set -euo pipefail

: "${PGURL:?PGURL required}"
MANIFEST_PATH="${MANIFEST_PATH:-/tmp/parity.manifest}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "verify-restore-parity: manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

fail=0
while read -r qname expected; do
  [[ -z "$qname" ]] && continue
  actual=$(psql "$PGURL" -Atc "SELECT COUNT(*) FROM ${qname};" 2>/dev/null || echo "MISSING")
  if [[ "$actual" != "$expected" ]]; then
    echo "MISMATCH: ${qname}  expected=${expected}  actual=${actual}" >&2
    fail=1
  else
    echo "ok: ${qname} = ${expected}"
  fi
done < "$MANIFEST_PATH"

exit "$fail"
