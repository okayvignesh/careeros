# Career OS — Dev Setup

From clone to running instance in ~10 minutes.

## Prerequisites

- Docker Desktop or Docker Engine + Compose v2
- Node.js 20+ (`nvm use` reads `.nvmrc`)
- pnpm 9+
- git

## Quickstart

```bash
git clone https://github.com/<org>/career-os.git
cd career-os
cp .env.example .env
# edit .env — at minimum set:
#   ENCRYPTION_KEY (32+ bytes, e.g. `openssl rand -hex 32`)
#   SESSION_SECRET (32+ bytes)
#   DEEPSEEK_API_KEY (or leave for wizard entry)

pnpm install
pnpm docker:up          # postgres + redis + qdrant + minio + squid + api + worker + web
pnpm migrate            # prisma migrate deploy
pnpm seed:test          # deterministic fixture user (realistic dev seed planned)
pnpm dev                # api + worker + web in parallel
```

Open `http://localhost:3000` — wizard redirects if setup incomplete, else dashboard.

> The stack also starts `nginx` on ports 80/443 as the public TLS entrypoint.
> For local dev without a domain, generate a self-signed cert once before
> `pnpm docker:up`:
>
> ```bash
> ./infra/nginx/self-signed.sh        # writes infra/nginx/certs/tls.{crt,key}
> ```
>
> Details and the production Let's Encrypt flow: [`infra/nginx/README.md`](../infra/nginx/README.md).
> The scheduled backup sidecar is opt-in (`docker compose --profile ops up -d backup`); see [`docs/backup.md`](backup.md).

## Common tasks

| Task | Command |
|---|---|
| Start dev stack | `pnpm dev` |
| Run all tests | `pnpm test` |
| Run e2e (Playwright) | `pnpm test:e2e` |
| Run AI evals | `pnpm test:evals` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Format | `pnpm format` |
| Reset DB | `pnpm db:reset` (nukes + migrates; re-seed with `pnpm seed:test`) |
| Seed test fixtures | `pnpm seed:test` |
| Regenerate Prisma client | `pnpm --filter @careeros/api prisma generate` |
| New migration | `pnpm --filter @careeros/api prisma migrate dev --name add_foo` |
| Regenerate ERD | Planned — `prisma-erd-generator` not wired yet (will write `docs/schema.png`) |
| View OpenAPI docs | Swagger UI at `http://localhost:3001/api/docs`; raw spec at `http://localhost:3001/api/openapi.json`. Generated from the shared Zod schemas (`zod-to-openapi`); both routes require a session when `NODE_ENV=production` |
| GlitchTip UI | Planned — GlitchTip compose service not added yet |

## Repo layout

See `AGENTS.md` §5 for full layout with responsibilities.

## Editor

VS Code recommended. `.vscode/` contains:
- `launch.json` — attach debugger to api or worker
- `settings.json` — format-on-save, ESLint, Tailwind IntelliSense
- Recommended extensions: `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `bradlc.vscode-tailwindcss`, `prisma.prisma`

## Test data

`pnpm seed:test` is an idempotent e2e fixture set:
- 1 user (email: `test@career-os.local`, password: `test-password-12345`)
- Career goal for a mid-level backend role (remote, UTC)
- 2 skills + 2 evidence rows
- 1 fixture job + 1 application

A richer `pnpm seed:dev` (12 skills across 4 clusters, 3 repos, 20 evidence rows, 5 jobs) is planned but not yet wired; see `plan/phase-0-install.md`.

## Environment reference

Every `.env` var documented inline in `.env.example`. Never commit `.env`.

## Troubleshooting

**Compose fails to start:** check port conflicts on 3000 (web), 3001 (api), 5432 (pg), 6379 (redis), 6333 (qdrant), 9000 (minio). Override in `.env`.

**Migrations fail:** `pnpm db:reset` nukes and rebuilds. Only in dev.

**Wizard loops:** `setup_state` row stuck; `pnpm db:reset` or manually update `setup_state.state = 'not_started'`.

**LLM calls fail in dev:** wizard capability test uses the key you entered. A standalone `pnpm ai:probe` script is planned but not yet wired.

**Playwright tests flake:** first run downloads browsers (~500MB). `pnpm playwright install` explicitly.

## Contributing

See `CONTRIBUTING.md` for PR flow, code style, review expectations.

## Architecture

See `docs/architecture.md` for the one-diagram + one-page view. See `AGENTS.md` for full domain rules.
