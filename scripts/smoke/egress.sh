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
# What we assert, driving Node global fetch (the path the app actually uses,
# NOT curl), from inside the api/worker container:
#   1. https://example.com is DENIED  (not on the allowlist)
#   2. https://api.deepseek.com/ is ALLOWED at the proxy level. Upstream will
#      almost certainly return 401 because we send no api key — that's the
#      allow-path signal. Anything that comes back that isn't a network-level
#      block counts as "the proxy let us through".
#   3. http://169.254.169.254/ (AWS metadata) is DENIED.
#   4. https://api.github.com/ is ALLOWED at the proxy level.

set -euo pipefail

SERVICE="${SERVICE:-api}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker/docker-compose.yml}"

# Node resolves `@careeros/shared/net` through the service package's
# node_modules symlink, so run from its package dir.
case "$SERVICE" in
  api) WORKDIR=/app/apps/api ;;
  worker) WORKDIR=/app/apps/worker ;;
  *) WORKDIR=/app/apps/api ;;
esac

echo "[egress-smoke] target service: $SERVICE (cwd $WORKDIR)"

# Node's global fetch ignores HTTP(S)_PROXY by default, so we call the same
# `installEgressProxy()` bootstrap that apps/{api,worker}/src/main.ts runs,
# then fetch. A blocked HTTPS CONNECT makes undici throw (curl would have
# reported 403), so we collapse any fetch rejection to NETERR. A blocked
# plain HTTP request returns 403 from squid.
check() {
  local label="$1" url="$2" expect_allowed="$3"
  local code
  code=$($COMPOSE exec -T -w "$WORKDIR" "$SERVICE" node -e '
    const { installEgressProxy } = require("@careeros/shared/net");
    installEgressProxy(process.env, () => {});
    fetch(process.argv[1])
      .then((r) => { console.log(r.status); process.exit(0); })
      .catch(() => { console.log("NETERR"); process.exit(0); });
  ' "$url")
  echo "[egress-smoke] $label -> $url -> $code"

  # Proxy-level blocks: squid deny (403/407), gateway errors, or a fetch
  # rejection (undici throws on a blocked CONNECT rather than returning 403).
  case "$code" in
    403|407|502|503|NETERR)
      if [[ "$expect_allowed" == deny ]]; then return 0; fi
      echo "[egress-smoke] FAIL: expected allowed, squid blocked $url (HTTP $code)" >&2
      return 1 ;;
    [234]*)
      # 2xx/3xx/4xx that squid did not refuse: e.g. 200 from github, 401 from
      # deepseek without an api key, or 404 on a valid host/path.
      if [[ "$expect_allowed" == allow ]]; then return 0; fi
      echo "[egress-smoke] FAIL: expected denied, got HTTP $code for $url" >&2
      return 1 ;;
    *)
      echo "[egress-smoke] FAIL: unexpected HTTP $code for $url" >&2
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
