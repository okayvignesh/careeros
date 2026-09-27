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
pnpm docker:up          # postgres + redis + qdrant + minio + embedding + glitchtip
pnpm migrate            # prisma migrate deploy
pnpm seed:dev           # realistic candidate data
pnpm dev                # api + worker + web in parallel
```

Open `http://localhost:3000` — wizard redirects if setup incomplete, else dashboard.

## Common tasks

| Task | Command |
|---|---|
| Start dev stack | `pnpm dev` |
| Run all tests | `pnpm test` |
| Run e2e (Playwright) | `pnpm test:e2e` |
| Run AI evals | `pnpm eval:ai` |
| Lint + typecheck | `pnpm check` |
| Format | `pnpm format` |
| Reset DB | `pnpm db:reset` (nukes + migrates + seeds) |
| Regenerate Prisma client | `pnpm prisma generate` |
| New migration | `pnpm prisma migrate dev --name add_foo` |
| Regenerate ERD | `pnpm erd` (writes `docs/schema.png`) |
| View OpenAPI docs | http://localhost:3001/api/docs |
| GlitchTip UI | http://localhost:9000 |

## Repo layout

See `AGENTS.md` §5 for full layout with responsibilities.

## Editor

VS Code recommended. `.vscode/` contains:
- `launch.json` — attach debugger to api or worker
- `settings.json` — format-on-save, ESLint, Tailwind IntelliSense
- Recommended extensions: `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `bradlc.vscode-tailwindcss`, `prisma.prisma`

## Test data

`pnpm seed:dev` creates:
- 1 user (email: `dev@career-os.local`, password: `dev-password-12345`)
- Career goals for a mid-level backend role
- 12 skills across 4 clusters with mixed evidence
- 3 seeded GitHub repos (mocked in dev — real GitHub OAuth optional)
- 20 evidence rows spanning all 6 types
- 5 fake job listings + 2 shortlisted applications

## Environment reference

Every `.env` var documented inline in `.env.example`. Never commit `.env`.

## Troubleshooting

**Compose fails to start:** check port conflicts on 3000 (web), 3001 (api), 5432 (pg), 6379 (redis), 6333 (qdrant), 9000 (minio+glitchtip). Override in `.env`.

**Migrations fail:** `pnpm db:reset` nukes and rebuilds. Only in dev.

**Wizard loops:** `setup_state` row stuck; `pnpm db:reset` or manually update `setup_state.state = 'not_started'`.

**LLM calls fail in dev:** wizard capability test uses the key you entered. Verify with `pnpm ai:probe` (runs a real DeepSeek chat + JSON + tool call and prints the result).

**Playwright tests flake:** first run downloads browsers (~500MB). `pnpm playwright install` explicitly.

## Contributing

See `CONTRIBUTING.md` for PR flow, code style, review expectations.

## Architecture

See `docs/architecture.md` for the one-diagram + one-page view. See `AGENTS.md` for full domain rules.
