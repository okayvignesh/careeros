#!/usr/bin/env bash
# C-P0.5b helper: snapshot public-table row counts before a backup so
# scripts/verify-restore-parity.sh can diff them after a restore.
#
# Usage: PGURL=postgresql://user:pass@host:5432/db scripts/manifest.sh [out]
# Output: "<schema>.<table> <row_count>" per line (whitespace-separated),
#         the exact shape verify-restore-parity.sh consumes.
#
# Tables are emitted schema-qualified, unquoted. Every Career OS model maps to
# a lowercase snake_case table (see apps/api/prisma/schema.prisma @@map), so
# identifier folding cannot bite. ponytail: row-count only; upgrade to per-row
# checksums in verify-restore-parity.sh if content ever diverges under parity.

set -euo pipefail

: "${PGURL:?PGURL required}"
OUT="${1:-/tmp/parity.manifest}"

tables="$(psql "$PGURL" -Atc "
  SELECT table_schema || '.' || table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;")"

: > "$OUT"
while IFS= read -r qname; do
  [[ -z "$qname" ]] && continue
  count="$(psql "$PGURL" -Atc "SELECT COUNT(*) FROM ${qname};")"
  printf '%s %s\n' "$qname" "$count" >> "$OUT"
done <<< "$tables"

echo "manifest: $(grep -c . "$OUT") tables -> $OUT"
