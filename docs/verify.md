# Verifying a Career OS release

Every tagged release ships:

1. `SHA256SUMS` + `SHA256SUMS.sig` (release archive checksums, GPG-signed).
2. `cosign`-signed container images pushed to `ghcr.io/<org>/career-os-{api,web,worker}`.
3. Syft-generated CycloneDX SBOM per image, attached to the GitHub Release.

This doc walks you through verifying each layer before you deploy.

## 0. Prereqs

```bash
# cosign 2.x
brew install cosign      # or: go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# syft (optional; only if you want to inspect the SBOM locally)
brew install syft

# GnuPG (for SHA256SUMS.sig)
brew install gnupg
```

## 1. Fetch the release

```bash
export VERSION=v0.1.0     # example
gh release download "$VERSION" --repo <org>/career-os --dir "./release-$VERSION"
cd "./release-$VERSION"
```

## 2. Verify the checksums file

```bash
gpg --verify SHA256SUMS.sig SHA256SUMS
sha256sum -c SHA256SUMS
```

Both must exit 0. `sha256sum -c` prints `<file>: OK` per line.

If the GPG key is not yet in your keyring:

```bash
gpg --recv-keys <RELEASE_KEY_FINGERPRINT>   # published in SECURITY.md
```

## 3. Verify the container images

We sign with `cosign` in keyless / OIDC mode. Every push to `main`
via the release workflow signs with the GitHub Actions identity.

```bash
export IMAGE=ghcr.io/<org>/career-os-api:$VERSION

cosign verify "$IMAGE" \
  --certificate-identity-regexp "https://github.com/<org>/career-os/.github/workflows/tag-release.yml@refs/tags/$VERSION" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Repeat for `career-os-web` and `career-os-worker`.

A successful verify prints the transparency log entry + the signed
predicate; a failure prints an error and exits non-zero.

## 4. Inspect the SBOM

```bash
cosign download attestation "$IMAGE" \
  --predicate-type=https://cyclonedx.org/bom \
  | jq -r '.payload' \
  | base64 -d \
  | jq '.predicate' > sbom-api.json

# quick health-check
jq -r '.components | length' sbom-api.json     # number of components
jq -r '.components[] | select(.name == "next") | .version' sbom-api.json
```

Match the components + versions against your policy (e.g. `next` >=
16.3, `@nestjs/*` on a supported major, no CVE-blacklisted package).

## 5. Verify signed commits on main

Releases are cut from tagged commits on `main`. Every commit on
`main` is signed via `gitsign` under the release workflow's OIDC
identity.

```bash
git log --show-signature -1 "$VERSION"
# -> gitsign transparency log entry + short-cert summary

# or verify a range of commits
git verify-commit HEAD~10..HEAD
```

## 6. Optional: rebuild locally + compare digests

If you want to prove the published image matches the source you have
checked out:

```bash
cd path/to/career-os
git checkout "$VERSION"
docker build -f infra/docker/api.Dockerfile -t local-api:$VERSION .

# Compare with the pulled tag digest.
docker inspect --format='{{.Id}}' local-api:$VERSION
docker inspect --format='{{.Id}}' "$IMAGE"
```

Reproducible builds are not a hard guarantee today (some layers
carry build-time timestamps); a digest mismatch is not automatically
a red flag. Use this step as a sanity check, not a security proof.

## Failure modes

| Symptom | Meaning | Action |
|---|---|---|
| `gpg: BAD signature` on `SHA256SUMS.sig` | Archive was tampered or the key rotated | Do NOT deploy; check `SECURITY.md` for the current key fingerprint |
| `sha256sum: FAILED` | Archive contents don't match manifest | Re-download; check upstream mirror |
| `cosign verify` non-zero | Image was not signed by the expected identity | Do NOT deploy; open a `security` issue |
| SBOM missing a component | Predicate did not attach or is stale | Regenerate + reattach via the release workflow before use |

Related: `docs/backup.md`, `SECURITY.md`, `docs/oauth-scope-audit.md`.
