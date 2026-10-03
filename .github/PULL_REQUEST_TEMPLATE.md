## Summary

<!-- What changed and why. Link the phase/slice or issue. -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / cleanup
- [ ] Docs only
- [ ] Security-sensitive
- [ ] Dependency / CI

## Checklist

- [ ] Diff is small and focused (split past ~400 lines across many files)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] New non-trivial logic has an adjacent test
- [ ] No em dashes in user-facing strings
- [ ] No generated files committed outside intentional build artifacts
- [ ] No secrets, tokens, or real PII committed (check `.env` files, fixtures, logs)
- [ ] `docs/codebase/` updated if code, config, architecture, or conventions changed
- [ ] Contributions are licensed under `AGPL-3.0-or-later`, and no added dependency or asset is license-incompatible

## Security-sensitive changes

Tick and describe if this touches authentication, session handling, secret
storage/encryption, OAuth scopes, egress paths, admin routes, or upload
handling. Cite the relevant item in `plan/security.md`.

- [ ] Not security-sensitive
- [ ] Security-sensitive. `plan/security.md` item: ______

## Breaking changes

- [ ] None
- [ ] Yes. Upgrade/downgrade steps described below and in `CHANGELOG.md`.

## Testing done

<!-- Commands run, and evidence (test names, screenshots for UI). -->
