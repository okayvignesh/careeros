# Edge channel

The `edge` channel tracks the tip of `main`. It is where work lands
before a tagged release. It exists so operators can try unreleased work,
not so they can run it in production.

**Read this first:** `edge` builds are **unsupported**. They are for
evaluation and feedback only. There is no security-fix guarantee, no
upgrade contract, and no data-loss guarantee. See
[`docs/support.md`](support.md) for the supported windows.

## What `edge` is

- Built from the `main` branch.
- Published under the `edge` container tag (not `stable`, not `latest`).
- **Not signed for verification purposes.** Do not treat a successful
  `cosign verify` expectation from [`docs/verify.md`](verify.md) as
  applying to `edge`. If you need verifiable provenance, run a tagged
  release.

## What `edge` is not

- Not a release candidate. RCs are `vX.y.z-rc.N`: tagged, signed, and
  published, but not tagged `stable`.
- Not covered by the upgrade contract in
  [`plan/release-process.md`](../plan/release-process.md).

## Before you switch

1. **Back up.** `bash scripts/backup.sh` and confirm the backup exists.
2. **Read the changelog.** [`CHANGELOG.md`](../CHANGELOG.md) `[Unreleased]`
   lists what changed since the last tag.
3. **Accept you may need to restore.** Migrations on `edge` may not be
   backward compatible with the release you came from.

## Option A: build `edge` from source (recommended)

The Compose services build from the local checkout, so running `main` is
just a checkout plus rebuild:

```bash
git checkout main
git pull
pnpm install
pnpm docker:rebuild   # builds api/web/worker images and restarts
```

To leave `edge`, check out a tag or `stable` and rebuild the same way.

## Option B: published `edge` images (when available)

When CI publishes `edge` images, they are under
`ghcr.io/okayvignesh/careeros-{api,web,worker}`. Override the locally
built services with a compose override file, for example
`infra/docker/docker-compose.edge.yml`:

```yaml
services:
  api:
    image: ghcr.io/okayvignesh/careeros-api:edge
  web:
    image: ghcr.io/okayvignesh/careeros-web:edge
  worker:
    image: ghcr.io/okayvignesh/careeros-worker:edge
```

Run with the override layered on top of the base file:

```bash
docker compose \
  --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.override.yml \
  -f infra/docker/docker-compose.edge.yml \
  up -d
```

## Switching back to stable

```bash
docker compose down
git checkout <tag-or-stable>
pnpm docker:rebuild
```

If the `edge` migration was not forward compatible with your previous
release, restore the backup you took before switching. This is exactly
why the backup step is first.

## Reporting edge issues

Feedback on `edge` is welcome and useful. Open a GitHub issue and say you
are on `edge`, with the commit SHA (`git rev-parse --short HEAD`). Issues
found on `edge` are lower priority than issues on a supported release.

## Related

- [`docs/support.md`](support.md) - support windows
- [`plan/release-process.md`](../plan/release-process.md) - channels,
  signing, SBOM
- [`docs/verify.md`](verify.md) - verifying tagged releases
