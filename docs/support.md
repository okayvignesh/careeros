# Support

What the Career OS project supports, and what it does not. This document
is the public statement of the support windows defined in
[`plan/release-process.md`](../plan/release-process.md).

## Pre-1.0 (where we are now)

Career OS is **alpha, pre-v0.1**. There are no compatibility promises
before the first tagged release (`v0.1.0`). Expect breaking changes
between minor versions, and read [`CHANGELOG.md`](../CHANGELOG.md) before
every upgrade.

## Support matrix (from `v0.1.0` onward)

| Release line | Status | What you get |
|---|---|---|
| **Current major** (latest `vX.y.z`) | Full support | Bug fixes, security patches, new features |
| **Previous major** | Security only | Security patches, until 6 months after the current major was released |
| **Older majors** | Unsupported | Upgrade path documented from the last supported version of each major |
| **Pre-release / `edge` / `vX.y.z-rc.N`** | Unsupported | Community best-effort only. No security-fix guarantee. See [`docs/edge.md`](edge.md) |

The container tags `v1.2`, `v1`, and `stable` always point at the newest
supported release in their line. There is deliberately **no `latest`
tag**, to avoid ambiguity.

## What "supported" means

- Upgrades are one command (`docker compose pull && docker compose up -d`).
- A supported upgrade never loses data; migrations run on API boot and
  fail loudly rather than leaving partial state.
- Downgrade paths are documented per release (or explicitly called out as
  not possible).
- Security fixes ship for versions inside the window above.

## What you must do

- Take a backup before every upgrade (`scripts/backup.sh`).
- Read the **Breaking** section of `CHANGELOG.md` before every major
  upgrade.
- Update within 30 days of a security advisory.

## Getting help

- **Questions, bugs, feature requests:** open a GitHub issue (use the
  templates). Include your version/commit and install method.
- **Security issues:** do NOT open a public issue. Use GitHub Security
  Advisories as described in [`SECURITY.md`](../SECURITY.md).
- **Before filing:** check [`CHANGELOG.md`](../CHANGELOG.md),
  [`docs/runbook.md`](runbook.md), and
  [`docs/incident-response.md`](incident-response.md).

## Response expectations

This is a small, maintainer-run project. There is no paid SLA. For
security reports, the commitments in [`SECURITY.md`](../SECURITY.md)
apply. For everything else, best effort.

## Related

- [`plan/release-process.md`](../plan/release-process.md) - versioning,
  upgrade contract, SBOM, signing
- [`docs/edge.md`](edge.md) - the unsupported pre-release channel
- [`docs/verify.md`](verify.md) - verifying signed releases
