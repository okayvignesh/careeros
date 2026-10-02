#!/usr/bin/env bash
# Host-mode dev: datastores in Docker, api + worker + web on the host.
#
# Referenced by `package.json` ("dev:host") and documented in docs/install.md.
# Pair with `pnpm docker:infra`, which starts postgres/redis/qdrant/minio/squid
# using infra/docker/docker-compose.host-dev.yml to publish them on
# localhost. This script then repoints the app env at localhost (compose service
# names like `postgres` only resolve inside the compose network) and runs the
# turbo dev pipeline.
#
# ponytail: no dotenv dependency. `.env` is simple KEY=VALUE (see .env.example),
# so sourcing it is enough; secrets are never generated here.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "dev-host: .env not found. Copy .env.example to .env and fill the required secrets." >&2
  exit 1
fi

# Load .env, then .env.local when present (same precedence as `pnpm docker:infra`).
set -a
# shellcheck disable=SC1091
source .env
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  source .env.local
fi
set +a

# Fail early with a clear message rather than at the first datastore call.
: "${POSTGRES_USER:?dev-host: POSTGRES_USER is required (see .env.example)}"
: "${POSTGRES_PASSWORD:?dev-host: POSTGRES_PASSWORD is required (openssl rand -base64 32)}"
: "${POSTGRES_DB:?dev-host: POSTGRES_DB is required (see .env.example)}"
: "${MINIO_ROOT_USER:?dev-host: MINIO_ROOT_USER is required (see .env.example)}"
: "${MINIO_ROOT_PASSWORD:?dev-host: MINIO_ROOT_PASSWORD is required (openssl rand -base64 32)}"
: "${ENCRYPTION_KEY:?dev-host: ENCRYPTION_KEY is required (openssl rand -hex 32)}"
: "${SESSION_SECRET:?dev-host: SESSION_SECRET is required (openssl rand -hex 32)}"

# Host-reachable datastore URLs. The published ports are 127.0.0.1-bound in
# docker-compose.host-dev.yml.
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=public"
export REDIS_URL="redis://localhost:6379"
export QDRANT_URL="http://localhost:6333"
export MINIO_ENDPOINT="localhost"
export MINIO_PORT="9000"
export MINIO_USE_SSL="false"
export MINIO_ACCESS_KEY="${MINIO_ROOT_USER}"
export MINIO_SECRET_KEY="${MINIO_ROOT_PASSWORD}"
export MINIO_BUCKET="${MINIO_BUCKET:-careeros}"

# Route host outbound HTTP(S) through the Squid allowlist proxy, matching the
# api/worker containers. Datastore + web traffic stays direct.
export HTTP_PROXY="http://localhost:3128"
export HTTPS_PROXY="http://localhost:3128"
export NO_PROXY="localhost,127.0.0.1,postgres,redis,minio,qdrant"

export NODE_ENV="${NODE_ENV:-development}"
export API_PORT="${API_PORT:-3001}"
export WEB_URL="${WEB_URL:-http://localhost:3000}"
export TRUSTED_ORIGINS="${TRUSTED_ORIGINS:-http://localhost:3000}"

echo "dev-host: datastores on localhost (postgres:5432 redis:6379 qdrant:6333 minio:9000 squid:3128)"
echo "dev-host: starting api (http://localhost:${API_PORT}) + web (${WEB_URL}) + worker"

exec pnpm dev
