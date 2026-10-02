# Egress control

Career OS routes all api + worker outbound HTTP(S) through a deny-by-default
Squid proxy. Two things enforce this:

1. **Network topology** — `api`/`worker` join the `egress` bridge; Squid gates
   destinations against the allowlist in `infra/docker/squid/squid.conf`.
2. **Process dispatcher** — Node's global `fetch` (undici) ignores
   `HTTP_PROXY`/`HTTPS_PROXY`, so `installEgressProxy()` installs an undici
   `EnvHttpProxyAgent` with `setGlobalDispatcher` at the start of api + worker
   bootstrap. Without this, app traffic would reach the internet directly on the
   `egress` bridge, bypassing the allowlist and the metadata-IP block.

`installEgressProxy()`:

- runs before any outbound call in `apps/api/src/main.ts` and
  `apps/worker/src/main.ts`;
- returns `false` (no-op) when no proxy is configured, e.g. local dev/CI;
- throws — aborting boot — if a proxy is configured but malformed, so the
  process can never silently egress directly;
- passes `NO_PROXY` through unchanged, so datastore hostnames
  (`postgres`, `redis`, `minio`, `qdrant`, `localhost`) are not proxied.

`apps/web` is deliberately excluded: undici is node-only and must not enter the
browser bundle. Web server-side fetches, if added later, must install the
dispatcher explicitly.

## Verify

- Unit: `pnpm test packages/shared/src/net/proxy-dispatcher.test.ts`.
- Live (requires the full compose stack): `./scripts/smoke/egress.sh` drives
  Node `fetch` through the same bootstrap and asserts `example.com` and
  `169.254.169.254` are denied while `api.deepseek.com` / `api.github.com`
  are allowed. A live Docker run is required to confirm Squid sees the traffic;
  unit tests only prove the dispatcher is installed.
