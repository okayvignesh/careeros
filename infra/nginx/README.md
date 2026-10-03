# nginx — public reverse proxy + TLS

The single public entrypoint for a Career OS deployment. It terminates TLS,
serves the ACME HTTP-01 challenge for Let's Encrypt, and routes:

| Public path | Upstream | Notes |
|---|---|---|
| `/` | `web:3000` | Next.js app. |
| `/api/*` | `api:3001` | `/api` prefix is **stripped**; the api's controllers are unprefixed (`auth`, `health`, `me/*`, …). |
| `/api/openapi.json`, `/api/docs` | `api:3001` | Passed through unrewritten because the api itself serves them under `/api`. |
| `/.well-known/acme-challenge/*` | files in `/var/www/certbot` | Served on port 80 for certbot. |
| `/healthz` | nginx itself | 200 on 80 and 443; used by the compose healthcheck. |

## Files

| File | Purpose | Mounted at |
|---|---|---|
| `nginx.conf` | main config: http block, proxy defaults, upgrade map, gzip | `/etc/nginx/nginx.conf` |
| `templates/careeros.conf.template` | rendered per environment by the image entrypoint | `/etc/nginx/templates/` (output `/etc/nginx/conf.d/careeros.conf`) |
| `certs/` | local self-signed cert/key (dev only, git-ignored) | `/etc/nginx/certs:ro` |
| `self-signed.sh` | generates `certs/tls.crt` + `certs/tls.key` | host |

`nginx.conf` includes `/etc/nginx/conf.d/careeros.conf` explicitly instead of a
glob so the image's baked-in `default.conf` can never shadow the site.

## Environment (from `.env`)

| Var | Default | Meaning |
|---|---|---|
| `SERVER_NAME` | `localhost` | Public DNS name(s); `server_name` value and cert CN. |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Published host ports. |
| `TLS_CERT_PATH` | `/etc/nginx/certs/tls.crt` | Cert path **inside** the container. |
| `TLS_KEY_PATH` | `/etc/nginx/certs/tls.key` | Key path inside the container. |
| `HSTS_MAX_AGE` | `0` | HSTS max-age seconds. `0` disables pinning for local dev; use `63072000` in production. |
| `ACME_EMAIL` | unset | Contact used by `certbot certonly` (real certs only). |

## Local / self-signed mode (no domain)

1. `SERVER_NAME=careeros.local ./infra/nginx/self-signed.sh` (or leave
   `SERVER_NAME` unset for `localhost`).
2. `pnpm docker:up` — nginx starts with the self-signed cert. `HSTS_MAX_AGE=0`
   keeps browsers from pinning it.
3. `https://localhost:${HTTPS_PORT}` (browser warning is expected).

If your host already uses 80/443, set `HTTP_PORT`/`HTTPS_PORT` in `.env`.

## Production: real Let's Encrypt certificate

Port 80 must be reachable from the internet and `SERVER_NAME` must resolve to
this host.

```
# 1. Boot nginx with the self-signed fallback (or a cert of any kind) so the
#    ACME challenge location is live on :80.
pnpm docker:up

# 2. Issue the certificate into the shared `letsencrypt` volume.
docker compose -f infra/docker/docker-compose.yml --env-file .env \
  run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "$SERVER_NAME" --email "$ACME_EMAIL" --agree-tos --no-eff-email

# 3. Point nginx at the real cert and restart it.
#    In .env:
#      TLS_CERT_PATH=/etc/letsencrypt/live/<domain>/fullchain.pem
#      TLS_KEY_PATH=/etc/letsencrypt/live/<domain>/privkey.pem
#      HSTS_MAX_AGE=63072000
pnpm docker:up
```

The `certbot` service then runs `certbot renew` every 12h in the background.
Renewal writes new files into the same volume, but nginx keeps the old cert
until it reloads. Reload after a renewal (the operator's renew cron, or
manually):

```
docker compose -f infra/docker/docker-compose.yml --env-file .env \
  exec -T nginx nginx -s reload
```

Renewal itself is only attempted for certificates that already exist, so the
service is inert until step 2 succeeds.

## Desktop agent (WSS)

The desktop agent talks to the same origin under the API base path:
`CAREEROS_API_URL=https://<SERVER_NAME>/api`. Its REST calls land on
`/api/agent/...` (stripped to `/agent/...`) and its socket.io namespace
`/agent/ws` arrives as `/api/agent/ws` → `/agent/ws`, so the long-lived WSS
connection inherits the same TLS cert and the `/api/` proxy's upgrade headers
and 3600s read timeout. Point `CAREEROS_WSS_URL` at the same value.

