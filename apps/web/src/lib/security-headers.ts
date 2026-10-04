/**
 * Security headers for responses served by the Next.js tier.
 *
 * In production nginx terminates TLS and adds HSTS/frame/nosniff/referrer, and
 * the API owns the nonce-based CSP for `/api/*`. But the web tier is also
 * reachable directly (dev, preview, self-host without nginx), so it sets the
 * same modern baseline itself. CSP is nonce-based: the middleware mints a
 * per-request nonce and passes it to Next via `x-nonce`, so the framework can
 * stamp its inline bootstrap scripts instead of needing `'unsafe-inline'`.
 *
 * The API's equivalent lives in `apps/api/src/main.ts`; keep the two lists in
 * sync when adding a directive.
 */

export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': HSTS_VALUE,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'fullscreen=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'picture-in-picture=()',
    'publickey-credentials-get=(self)',
    'screen-wake-lock=()',
    'sync-xhr=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '),
};

/**
 * Build the web CSP. `script-src` is `'self' 'unsafe-inline'` (+ `'unsafe-eval'`
 * in dev for HMR). It is NOT nonce-based: Next statically prerenders pages, so
 * a per-request nonce never reaches the inline bootstrap/flight scripts and a
 * nonce-only policy blocks them (the app fails to hydrate). `'unsafe-inline'`
 * is the standard trade-off for static Next output; revisit with dynamic
 * rendering + a nonce/hash if XSS hardening is prioritized. See
 * plan/security.md item 2.
 *
 * `style-src` keeps `'unsafe-inline'`: React sets inline `style` attributes and
 * framer-motion animates through the CSSOM, both of which a nonce cannot cover.
 */
export function buildCsp(_nonce: string, apiOrigin?: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** API origin allowed for browser fetch/XHR (`NEXT_PUBLIC_API_URL`). */
export function apiOrigin(): string | undefined {
  const url = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL;
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
