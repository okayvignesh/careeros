# Releasing the desktop agent

The Electron companion agent (`apps/desktop`) ships as an **unsigned** MVP
installer. This document covers the two ways it gets built and published, plus
the Gatekeeper/SmartScreen workaround users need on first launch.

Artifacts are attached to GitHub Releases on `desktop-v*` tags, which is what
`DESKTOP_RELEASES_URL` in `apps/web/src/lib/agent.ts` links to and what
`electron-updater` in `apps/desktop/src/updater.ts` reads for updates.

## Local unsigned macOS build

From `apps/desktop` (macOS host; arm64 here):

```bash
cd apps/desktop
export PATH="$HOME/.local/bin:$PATH"
# Do NOT set CSC_LINK="" — an empty CSC_LINK is treated by electron-builder as
# "a certificate to import" and the build dies with `... not a file`.
unset CSC_LINK CSC_KEY_PASSWORD CSC_INSTALLER_LINK CSC_INSTALLER_KEY_PASSWORD
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm build
pnpm exec electron-builder --config electron-builder.yml --mac --publish never
```

Output lands in `apps/desktop/release/`:

- `Career OS Agent-0.0.1-arm64.dmg` — the installer
- `Career OS Agent-0.0.1-arm64.dmg.blockmap` — differential-update map
- `latest-mac.yml` — `electron-updater` feed metadata

The app is **ad-hoc / linker-signed only** (`codesign -dv` shows
`Signature=adhoc`, no Team ID) — Apple Silicon will quarantine it on download.

> If the checkout has no `.git` (e.g. a build sandbox), electron-builder can't
> derive the GitHub owner/repo for the update feed and fails with
> `Cannot read properties of null (reading 'provider')`. Set
> `TRAVIS_REPO_SLUG=okayvignesh/careeros` for local builds to resolve it.

## CI release path (all platforms)

Windows (NSIS `.exe`) and Linux (`.AppImage`) are built by
`.github/workflows/desktop-release.yml`, which triggers on a `desktop-v*` tag
push and publishes all three OS artifacts to the matching GitHub Release:

```bash
git tag desktop-v0.0.1
git push origin desktop-v0.0.1
```

The workflow uses `secrets.GITHUB_TOKEN` (`contents: write`) and the
`publish` block in `electron-builder.yml`. Notarization (macOS) and an EV cert
(Windows) are deliberately not wired yet — add the Apple/Windows secrets to the
workflow and a `notarize` block when signing lands.

## Gatekeeper / SmartScreen workaround

Unsigned builds are blocked on first launch. macOS gate is notarization; Windows
is SmartScreen reputation.

**macOS** — either:

```bash
xattr -dr com.apple.quarantine "/Applications/Career OS Agent.app"
```

or right-click (Control-click) the app in Finder → **Open** → **Open** again.

**Windows** — on the SmartScreen prompt click **More info** → **Run anyway**.

## Notes

- The repo is private, so anyone downloading a release must be signed in to
  GitHub with access. Anonymous `github.com/.../releases/...` requests 404.
- The macOS DMG is Apple Silicon (arm64). An Intel/x64 or universal build would
  need `--x64` / `--universal` and the matching CI matrix entry.
- `electron-updater` needs the `latest-mac.yml` + `.blockmap` assets uploaded
  alongside the DMG; local builds produce them but do not upload (`--publish never`).
