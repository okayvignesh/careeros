#!/usr/bin/env bash
# A-H8: operator smoke for the Squid egress allowlist. Not run in CI (needs
# the full compose stack up) — run manually after any change to squid.conf
# or the compose network topology. Exits 0 if the allowlist behaves; 1 if
# either the deny path lets something through or the allow path is blocked.
#
# Usage:
#   docker compose -f infra/docker/docker-compose.yml up -d
#   ./scripts/smoke/egress.sh
#
# What we assert, from inside the api container:
#   1. https://example.com is DENIED  (not on the allowlist)
#   2. https://api.deepseek.com/ is ALLOWED at the proxy level. Upstream will
#      almost certainly return 401 because we send no api key — that's the
#      allow-path signal. Anything that comes back that isn't a network-level
#      block counts as "the proxy let us through".
#   3. https://169.254.169.254/ (AWS metadata) is DENIED.

set -euo pipefail

SERVICE="${SERVICE:-api}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker/docker-compose.yml}"

echo "[egress-smoke] target service: $SERVICE"

# `curl -sS -o /dev/null -w '%{http_code}'` returns the HTTP status the proxy
# gave us. When squid refuses, curl reports 403. When squid lets through and
# upstream answers 401, we see 401. Anything else is a bug.

check() {
  local label="$1" url="$2" expect_allowed="$3"
  local code
  code=$($COMPOSE exec -T "$SERVICE" sh -c \
    "curl -sS -o /dev/null -w '%{http_code}' --max-time 8 '$url' || echo NETERR")
  echo "[egress-smoke] $label -> $url -> $code"
  case "$expect_allowed:$code" in
    deny:403|deny:407|deny:502|deny:503|deny:NETERR)
      return 0 ;;
    allow:2*|allow:3*|allow:4*)
      # Any status other than 403/502/503/NETERR means squid did not block us.
      # 401 from deepseek without a real api key is exactly what we expect.
      return 0 ;;
    *)
      echo "[egress-smoke] FAIL: expected $expect_allowed, got HTTP $code for $url" >&2
      return 1 ;;
  esac
}

fail=0
check 'deny non-allowlisted host'  'https://example.com'            deny  || fail=1
check 'deny cloud metadata IP'     'http://169.254.169.254/latest'  deny  || fail=1
check 'allow deepseek at proxy'    'https://api.deepseek.com/'      allow || fail=1
check 'allow github api at proxy'  'https://api.github.com/'        allow || fail=1

if [[ $fail -ne 0 ]]; then
  echo "[egress-smoke] one or more checks failed"
  exit 1
fi
echo "[egress-smoke] OK"
