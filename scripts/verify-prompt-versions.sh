#!/usr/bin/env bash
# C-P0.2c: fail CI if a prompt catalog file changed WITHOUT its `version:`
# field changing. Owning specs: ai-safety.md item 3 (prompt registry —
# versioned, hashed, tested; CI check enforces version bump).
#
# What "prompt catalog file" means here: any *.ts under
# packages/ai/src/prompts/catalog/ except the registry, hash-log, index, and
# *.test.ts files. Each catalog entry exports a Prompt object whose `version`
# field is the audit contract — bumping it forces a new row in llm_calls,
# rotates the hash, and triggers the golden-eval regen.
#
# Baseline: ${BASELINE_REF:-HEAD~1}. Set BASELINE_REF to the PR base (e.g.
# origin/main) in CI.
#
# Exits 0 when every changed catalog file also changed its version line.
# Exits 1 (with the offending id + file path) otherwise.

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG_DIR="$ROOT/packages/ai/src/prompts/catalog"
BASELINE="${BASELINE_REF:-HEAD~1}"

if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "verify-prompt-versions: catalog dir not found at $CATALOG_DIR" >&2
  exit 1
fi

# Only prompt entry files: skip registry.ts, hash-log.ts, index.ts, *.test.ts.
list_catalog_files() {
  find "$CATALOG_DIR" -maxdepth 1 -type f -name '*.ts' \
    ! -name 'registry.ts' \
    ! -name 'hash-log.ts' \
    ! -name 'index.ts' \
    ! -name '*.test.ts' \
    | sort
}

# Files changed since the baseline (added / modified). Use --diff-filter to
# skip pure deletions — a deleted prompt has no version to bump.
changed_files() {
  git diff --name-only --diff-filter=AM "$BASELINE"...HEAD -- "$CATALOG_DIR" || true
}

# Extract the `version: 'X.Y.Z'` (single OR double quoted) string from a file
# as it exists on disk (post-change). Empty if not found.
extract_version_at() {
  local ref="$1"
  local path="$2"
  git show "${ref}:${path}" 2>/dev/null \
    | grep -Eo "version:[[:space:]]*['\"][^'\"]+['\"]" \
    | head -1 \
    | grep -Eo "['\"][^'\"]+['\"]" \
    | tr -d "\"'" \
    || true
}

# Extract from current working tree (unstaged edits count too — CI checks
# out the PR head so working tree == HEAD, but this makes local runs sane).
extract_version_now() {
  local path="$1"
  grep -Eo "version:[[:space:]]*['\"][^'\"]+['\"]" "$path" \
    | head -1 \
    | grep -Eo "['\"][^'\"]+['\"]" \
    | tr -d "\"'" \
    || true
}

# Extract the id: field so error messages name the prompt, not just the path.
extract_id_now() {
  local path="$1"
  grep -Eo "id:[[:space:]]*['\"][^'\"]+['\"]" "$path" \
    | head -1 \
    | grep -Eo "['\"][^'\"]+['\"]" \
    | tr -d "\"'" \
    || true
}

failed=0
touched="$(changed_files || true)"

if [[ -z "$touched" ]]; then
  echo "verify-prompt-versions: no catalog files changed since $BASELINE — nothing to check"
  exit 0
fi

while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  abs="$ROOT/$rel"

  # Skip non-entry files (registry/hash-log/index/test) if they appear in the
  # diff — they don't declare a prompt version.
  case "$(basename "$rel")" in
    registry.ts|hash-log.ts|index.ts|*.test.ts)
      continue
      ;;
  esac

  # A new file (didn't exist at baseline) is fine — it establishes the first
  # version. Only enforce the bump when both sides exist.
  if ! git cat-file -e "${BASELINE}:${rel}" 2>/dev/null; then
    continue
  fi

  before="$(extract_version_at "$BASELINE" "$rel" || true)"
  after="$(extract_version_now "$abs" || true)"
  id="$(extract_id_now "$abs" || true)"

  if [[ -z "$after" ]]; then
    echo "verify-prompt-versions: FAIL — $rel has no version: field" >&2
    failed=1
    continue
  fi

  if [[ "$before" == "$after" ]]; then
    echo "verify-prompt-versions: FAIL — Prompt ${id:-<unknown>} changed without version bump (still $after)" >&2
    echo "  file: $rel" >&2
    echo "  bump the 'version:' field (semver) so audit rows + hash log rotate." >&2
    failed=1
  fi
done <<< "$touched"

if [[ $failed -ne 0 ]]; then
  exit 1
fi

echo "verify-prompt-versions: OK (all changed catalog files bumped their version)"
