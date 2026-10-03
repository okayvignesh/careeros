#!/usr/bin/env bash
# Generate a self-signed TLS cert so the nginx entrypoint works locally
# without a real domain or Let's Encrypt round-trip.
#
# The nginx service bind-mounts infra/nginx/certs at /etc/nginx/certs and the
# rendered server block defaults TLS_CERT_PATH/TLS_KEY_PATH to those files.
#
#   ./infra/nginx/self-signed.sh
#   SERVER_NAME=careeros.local ./infra/nginx/self-signed.sh
#
# Then bring the stack up (HTTP_PORT/HTTPS_PORT may be overridden):
#   pnpm docker:up
#   # https://localhost:443  (browser warning is expected for a self-signed cert)
#
# Production does NOT use this file. See infra/nginx/README.md.

set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
name="${SERVER_NAME:-localhost}"
# server_name may carry several hosts; the cert CN takes the first.
cn="${name%% *}"
dir="$here/certs"

command -v openssl >/dev/null 2>&1 || {
  echo "openssl not found on PATH" >&2
  exit 1
}

mkdir -p "$dir"

# A throwaway config works on both OpenSSL and macOS LibreSSL, which lacks
# `-addext`. `openssl req -config` is supported by both.
cfg="$(mktemp)"
trap 'rm -f "$cfg"' EXIT
cat > "$cfg" <<EOF
[req]
distinguished_name = dn
x509_extensions    = v3_req
prompt             = no
[dn]
CN = $cn
[v3_req]
basicConstraints = CA:FALSE
keyUsage         = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt
[alt]
DNS.1 = $cn
DNS.2 = localhost
IP.1  = 127.0.0.1
EOF

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$dir/tls.key" -out "$dir/tls.crt" \
  -config "$cfg" -extensions v3_req

chmod 600 "$dir/tls.key"
echo "wrote $dir/tls.crt (CN=$cn, valid 825 days, for local dev only)"
