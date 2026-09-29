# Changelog

All notable, user-visible changes to Career OS. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/) once we reach `v1.0.0`.

## [Unreleased]

Wave A/B/C/D/E/F/G work in progress toward v1.0. High-level buckets:

### Added
- Wave A: full security hardening pass (rate-limit, SSRF gate, CSRF, HSTS,
  session revocation, passkey, PAT scope gates for GitHub + GitLab,
  encrypted-at-rest for sensitive fields, MinIO signed URLs, `__Host-`
  cookies).
- Wave B: test backfill for shipped services (assessments, resume-variants,
  cover-letters, market-brief, GitHub sync, skills, embeddings,
  renderResumePdf, job-pipeline).
- Wave C: P0-P4 rollout (AI provider registry, prompt registry + hash log,
  sensitivity gate, Testcontainers + Playwright infra, GitHub Actions
  CI, passkey + recovery codes, backup + restore scripts, GitLab
  integration, commit ingest, learning-priority formula, ESCO seed,
  Prisma 6 migration, sandbox package + security suite, Monaco editor,
  quest generator, agent registry, ATS + aggregator adapters, verify
  stage, seniority + comp classifier, market snapshots, matcher,
  DOCX renderer, dossier pipeline, fact-check gate, metrics).
- Wave D: desktop agent platform partial (browser-agent package,
  agent-device migrations, WSS gateway, JWT scope + refresh rotation,
  pairing rate limit, LinkedIn discover script).
- Wave E: daily assistant partial (Slack Events, Gmail Pub/Sub, email
  parsers, email-ingest, email classifier, packages/messaging Channel
  interface, daily-brief composer + tz-aware scheduler, inbox triage +
  email-application fuzzy links).
- Wave F: controlled execution partial (approval queue, audit-log
  append-only, F.11a Gmail webhook rate-limit + F.11c OAuth scope
  audit, `/me/export` + `/me/delete` data portability, advanced usage
  + costs backend, interview prep + talk-track with fact-check gate,
  outreach composer with 5 templates x 4 industry variants).
- `renovate.json` for weekly dep PRs.
- `docs/oauth-scope-audit.md` source of truth for integration scopes.

### Notes
- Web (Next.js) surface is owned by a parallel workstream; UI-side
  entries land when that stream is released.
- Public-release blockers (Slack marketplace, Gmail verification,
  Electron notarization, MinIO base image, LICENSE + OSS decision)
  tracked in `plan/DEFERRED.md`.

<!-- Template for the first release:

## [0.1.0] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Security
- ...
-->
