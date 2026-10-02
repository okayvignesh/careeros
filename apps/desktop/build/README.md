# Packaging resources (D.6)

electron-builder picks up every file in this directory as a build resource:

- `icon.png` is a 512x512 solid-color placeholder. electron-builder derives
  Windows `.ico` and macOS `.icns` from it automatically for the unsigned MVP
  build. Replace with real brand assets when the logo folder is adopted.

- Entitlements (`entitlements.mac.plist`) and provisioning profiles belong
  here once macOS notarization is wired. Phase-3.5 non-goal; see
  `apps/desktop/README.md` for the upgrade path.

Nothing in this folder ships in the installed app; these are build-side
assets only.
