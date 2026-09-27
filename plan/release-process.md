# Career OS — Release Process

Cross-cutting release contract for an OSS self-hostable tool. Operators must be able to upgrade with one command and never lose data.

**Applies from the first tagged release (`v0.1.0`).** Before then, the repo is pre-release; no compatibility promises.

---

## Versioning

**Semantic versioning:** `MAJOR.MINOR.PATCH`.

| Bump | When | Operator impact |
|---|---|---|
| **MAJOR** | Breaking upgrade — manual step required (config format change, migration that must run offline, dropped feature) | Must read `CHANGELOG.md` before upgrading |
| **MINOR** | New feature, schema addition, adapter added | Safe to auto-upgrade with backup |
| **PATCH** | Bug fix, security patch, dep bump | Always safe to auto-upgrade |

**Pre-1.0:** minor bumps may include breaking changes (semver convention); called out loudly in `CHANGELOG.md`.

**Container tags per release:**
- `v1.2.3` — exact release, immutable
- `v1.2` — latest patch of 1.2
- `v1` — latest minor of 1.x
- `stable` — latest stable release across all majors
- **No `latest` tag** — refuses ambiguity.

---

## Upgrade contract

Operators run **one command** to upgrade:

```
docker compose pull && docker compose up -d
```

- Migrations run **automatically on API boot**, wrapped in a transaction where possible.
- If migration fails, API exits with a clear error; no partial state.
- Old and new containers can share the database briefly during a rolling upgrade (backward-compatible schema).
- Downgrade path documented per release when possible; when not, called out in `CHANGELOG.md` under **Downgrade** section.

### Migration rules (Prisma or Drizzle)

- **Forward-safe only.** Additive first: add column nullable → deploy → backfill → deploy again to enforce NOT NULL.
- **Never drop a column in the same release it stops being used.** Two-release deprecation minimum:
  - Release N: stop reading/writing the column, mark deprecated in comment.
  - Release N+1: drop the column.
- **Never rename** — add new, dual-write, migrate reads, drop old (three releases).
- **Every migration named descriptively:** `add_evidence_source_column`, not `20260921_migration`.
- **Every migration idempotent:** running twice must not corrupt.
- **Data migrations >1 minute run in a background worker**, not inline on API boot.

### Config format changes

- New config keys have sensible defaults; old configs continue to boot.
- Removed config keys log a warning for one MAJOR cycle before erroring.
- Renamed keys accepted under both names for one MAJOR cycle.

---

## CHANGELOG

`CHANGELOG.md` at repo root. [Keep a Changelog](https://keepachangelog.com/) format.

**Every release entry has:**

```
## [1.2.0] — 2026-11-15

### Breaking
- (nothing) OR list — with upgrade steps

### Security
- Item + CVE ID if applicable

### Added
- Item

### Changed
- Item

### Deprecated
- Item

### Removed
- Item

### Fixed
- Item

### Downgrade
- Steps to go back to 1.1.x, or "not supported this release"
```

- Breaking changes always at the top.
- Every entry links to the PR.
- No release ships without a changelog entry (CI enforces).

---

## Release checklist

Every release:

- [ ] `CHANGELOG.md` updated with all entries under `[Unreleased]` moved under new version
- [ ] Version bumped in root `package.json` and all `apps/*/package.json`
- [ ] Migration files reviewed for forward-safety
- [ ] Upgrade steps in changelog manually tested (`compose pull && up` on last version's data)
- [ ] `docs/` updated for any user-visible change
- [ ] `CHANGELOG.md` "Breaking" section reviewed by a human (never auto-generated)
- [ ] Tag pushed: `git tag -s v1.2.0 -m "..."` (signed)
- [ ] GitHub Release drafted from tag, populated from CHANGELOG entry
- [ ] CI builds + signs + publishes container images
- [ ] SBOM (CycloneDX) attached as release asset per image
- [ ] `SHA256SUMS` attached as release asset
- [ ] Verification instructions link included in release body

---

## Signing

### Commits
- Sigstore `gitsign` configured for all maintainers.
- Branch protection on `main`: signed commits required.

### Container images
- CI publishes to `ghcr.io/<org>/careeros-{web,api,worker,agent}`.
- `cosign` signs every published image with keyless OIDC (Sigstore).
- Operators verify with:
  ```
  cosign verify ghcr.io/<org>/careeros-api:v1.2.3 \
    --certificate-identity-regexp '^https://github.com/<org>/careeros' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```
- Verification steps in `docs/verify.md`.

### Desktop agent installers (P3.5+)
- MVP: unsigned, users get Gatekeeper / SmartScreen warning; documented workaround.
- Post-v1.0: Apple notarization + Windows EV cert.
- Regardless of signing state, `SHA256SUMS` published; users verify manually.

---

## SBOM

- **Format:** CycloneDX JSON.
- **Generated per container image per release** via `syft`.
- **Published:** as GitHub Release asset alongside each image.
- **Contents:** all runtime + build-time deps with versions + licenses + purls.
- **Consumers can:** grep for CVE-affected packages, run OSV scanner against a specific release.

---

## Support windows

- **Current MAJOR** — full support: patches, security, features.
- **Previous MAJOR** — security patches only, until 6 months after the current MAJOR was released.
- **Older** — unsupported; upgrade path documented from the last supported version of each MAJOR.

Publicly stated in `docs/support.md`.

---

## Security releases

Handled per `SECURITY.md`:

- Coordinated-disclosure window: 90 days default, negotiable.
- Fixed release cut on a fast track — CI + tag + publish + release notes within 24h of the fix.
- Advisory published on GitHub Security Advisories with CVE ID (requested via GitHub).
- Downstream notification: mailing list (if we have one) + Discussions announcement.
- Backports to previous MAJOR if within support window.

---

## Pre-release channels

- `main` branch → built as `edge` tag (not signed for verification purposes; operators use at own risk).
- Release candidates: `v1.2.0-rc.1` — tagged, signed, published, but not tagged `stable`.
- Operators can opt into `edge` via compose file swap, documented in `docs/edge.md`.

---

## What operators can rely on

- **One command to upgrade.**
- **Never lose data on a supported upgrade.**
- **Every release verifiably built from a specific commit.**
- **Every dependency traceable via SBOM.**
- **Downgrade documented (or explicitly not possible).**
- **90-day security disclosure.**

## What operators MUST do

- Read the "Breaking" section of `CHANGELOG.md` before every MAJOR upgrade.
- Take a backup before every upgrade (`scripts/backup.sh`).
- Verify container image signatures if their threat model requires it.
- Update within 30 days when a security advisory ships.
