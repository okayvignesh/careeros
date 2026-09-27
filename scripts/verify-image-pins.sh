#!/usr/bin/env bash
# A-M7: fail CI if any `image:` line in a compose file lacks an `@sha256:…`
# digest. Enforcement of security.md item 10 ("Container images pinned by
# SHA-256 in docker-compose.yml, not :latest").
#
# Exits 0 if every image is digest-pinned. Exits 1 (and prints the offenders)
# otherwise.

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# All compose files under infra/. Extend if we add more.
COMPOSE_FILES=$(find "$ROOT/infra" -type f \( -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' \))

if [[ -z "$COMPOSE_FILES" ]]; then
  echo "verify-image-pins: no compose files found under infra/" >&2
  exit 1
fi

failed=0
for f in $COMPOSE_FILES; do
  # Grep every `image:` line that is not commented out. Then filter out any
  # line that already contains `@sha256:` followed by 64 hex chars.
  while IFS= read -r line; do
    # Strip leading whitespace for readability in the error message.
    trimmed=$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')
    # Skip commented-out lines.
    case "$trimmed" in \#*) continue ;; esac
    # If it's a digest pin, accept.
    if [[ "$trimmed" =~ @sha256:[0-9a-f]{64} ]]; then
      continue
    fi
    echo "unpinned image in $f: $trimmed" >&2
    failed=1
  done < <(grep -E '^[[:space:]]*image:[[:space:]]' "$f" || true)
done

if [[ $failed -ne 0 ]]; then
  echo "" >&2
  echo "Pin every image by digest, e.g.:" >&2
  echo "  image: postgres@sha256:<64-hex>" >&2
  echo "Discover the digest with: docker buildx imagetools inspect <ref>" >&2
  exit 1
fi

echo "verify-image-pins: OK (all images in $(printf '%s ' "${COMPOSE_FILES[@]}") are digest-pinned)"
