# Installing Career OS

Career OS is a self-hosted single-user tool. Target: a Linux VPS or
your own laptop, running Docker + Node.

## Prerequisites

- Docker 24+ and Docker Compose v2
- Node 20+ (for `pnpm` + running dev commands)
- pnpm 9.12+
- Optional: `age` for encrypted backups
- Optional: `cosign` for verifying signed release images

## Fresh install (VPS)

```bash
# 1. clone
git clone <this-repo> career-os
cd career-os

# 2. secrets - generate strong values
cp .env.example .env
{
  echo "MASTER_KEY=$(openssl rand -hex 32)"
  echo "SESSION_SECRET=$(openssl rand -hex 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "REDIS_URL=redis://redis:6379"
  echo "NODE_ENV=production"
} >> .env
# See .env.example for the full list of required + optional keys.

# 3. workspace deps + boot
pnpm install
pnpm docker:up
pnpm migrate

# 4. first run wizard
open https://your-domain.example.com
# The setup wizard walks through:
#   - admin account (email + password + optional passkey)
#   - AI provider (DeepSeek / OpenAI / local Ollama; API key encrypted)
#   - embedder (local bge-small-en default; external is opt-in)
#   - integrations (GitHub PAT + Gmail OAuth + Slack manifest)
```

## Dev laptop (host-mode)

Faster iteration; datastores in Docker, API + Web on the host.

```bash
pnpm docker:infra   # postgres + redis + qdrant + minio + squid only
pnpm dev:host       # api at :3001, web at :3000, hot reload
```

## Prod checklist

- [ ] Reverse proxy (nginx or Caddy) terminates TLS. Let's Encrypt
      via certbot is the default per `plan/COMPLETION_PLAN.md` §6.
- [ ] Postgres `sslmode=require` to the reverse-proxied bouncer.
- [ ] `USAGE_STATS=on` env if you opt in to anonymous usage stats.
- [ ] `.env` file permissions `600`.
- [ ] `scripts/backup.sh` scheduled (cron or systemd timer). See
      `docs/backup.md` for restore drill.
- [ ] Weekly `restore-test.yml` workflow enabled (needs a fresh
      volume mount for the CI run to be meaningful).
- [ ] `docs/verify.md` steps run before shipping any new image.
- [ ] Passkey enrolled for the admin user (recovery codes stored
      offline via `POST /auth/recovery/generate`).

## Upgrading

```bash
git pull
pnpm install
pnpm migrate            # runs pending Prisma migrations
pnpm docker:rebuild     # rebuilds api + web images

# On any dep addition:
docker compose up -d --build --renew-anon-volumes api web
```

## Troubleshooting

- **Wizard shows "service unavailable"**: middleware fails closed
  when the API is unreachable. Check `docker compose ps` and
  `docker compose logs api`.
- **`MASTER_KEY too short`**: must be 64 hex or 44-char base64.
  Regenerate with `openssl rand -hex 32`.
- **Slack install warns about missing scopes**: check
  `docs/oauth-scope-audit.md` and update the Slack app manifest.
- **Gmail OAuth callback state mismatch**: sign-out then sign back
  in before re-triggering the OAuth flow.
- **MinIO 401 on downloads**: signed URLs expire; refresh from the
  UI or `POST /resume/:id/signed-url`.

## Related docs

- `docs/backup.md` - backup + restore procedure
- `docs/dev-setup.md` - developer environment details
- `docs/architecture.md` - end-to-end system view
- `docs/verify.md` - release image verification
- `docs/threat-model-operator.md` - what an operator needs to worry about
- `docs/oauth-scope-audit.md` - per-integration OAuth scope inventory
- `docs/audit-log.md` - immutability guarantees + rotation
- `docs/dossier.md` - company dossier pipeline
- `docs/slack-setup.md` - Slack app + OAuth walkthrough
- `SECURITY.md` - security policy + disclosure
