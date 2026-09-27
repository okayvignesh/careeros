# Career OS

Self-hosted, provider-agnostic Personal AI Career Operating System.

Continuously updated digital twin of one candidate — resume + GitHub + assessments + market signals + application outcomes — driving daily learning and job execution through Slack + Gmail, with every outbound action gated by an approval queue and every LLM call bounded by a sensitivity gate, cost budget, and audit log.

## Quickstart

```bash
# 1. clone + install
git clone <this-repo> career-os && cd career-os
cp .env.example .env
# edit .env — generate secrets with `openssl rand -hex 32`

# 2. start
pnpm install
pnpm docker:up
pnpm migrate

# 3. visit
open http://localhost:3000   # wizard redirects if setup incomplete
open http://localhost:3001/health   # service status JSON
```

## Status

**Alpha — pre-v0.1.** Under active P0 development. See [`plan/PLAN.md`](plan/PLAN.md) for the phase roadmap and [`docs/architecture.md`](docs/architecture.md) for the end-to-end system view.

## Docs

| Doc | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Rules for anyone (human or AI) editing this codebase |
| [`docs/architecture.md`](docs/architecture.md) | End-to-end system, data lifecycles, golden-path sequences |
| [`docs/dev-setup.md`](docs/dev-setup.md) | Clone → running in 10 minutes |
| [`plan/PLAN.md`](plan/PLAN.md) | Implementation plan, decisions, phase status |
| [`plan/security.md`](plan/security.md) | 10 security items with acceptance criteria |
| [`plan/ai-safety.md`](plan/ai-safety.md) | Hallucination, injection, agent boundaries, evals |
| [`plan/testing.md`](plan/testing.md) | Test types, LLM eval pattern, CI structure |
| [`plan/observability.md`](plan/observability.md) | Logs, metrics, errors, health |
| [`plan/release-process.md`](plan/release-process.md) | Semver, signing, SBOM, changelog |

## License

TBD.
