import { test, expect, type APIResponse } from '@playwright/test';

/**
 * plan/security.md item 2 — every response carries the modern header set.
 *
 * Uses `request` (APIRequestContext) rather than a browser so it runs in the
 * CI Playwright job with no page/JS dependency. Paths exercise all three
 * tiers: a public page, a setup-wizard page, and the health endpoint. With no
 * nginx in front in CI, `/api/*` is served by the web tier's own route.
 */
const PATHS = ['/', '/setup/01-preflight', '/api/health'];

const REQUIRED: Record<string, RegExp> = {
  'strict-transport-security': /max-age=63072000/,
  'x-frame-options': /deny/i,
  'x-content-type-options': /nosniff/i,
  'referrer-policy': /strict-origin-when-cross-origin/i,
  // One representative lock-down each for camera + geolocation.
  'permissions-policy': /camera=\(\).*geolocation=\(\)/,
};

function assertSecurityHeaders(res: APIResponse): void {
  const headers = res.headers();
  const csp = headers['content-security-policy'];
  expect(csp, 'Content-Security-Policy missing').toBeTruthy();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  // Nonce-based script policy, not `'unsafe-inline'`.
  expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
  if (process.env.NODE_ENV === 'production') {
    const scriptSrc = /script-src[^;]*/.exec(csp ?? '')?.[0] ?? '';
    expect(scriptSrc, 'production CSP must not allow inline scripts').not.toContain(
      "'unsafe-inline'",
    );
  }

  for (const [name, pattern] of Object.entries(REQUIRED)) {
    expect(headers[name], `${name} missing/invalid`).toMatch(pattern);
  }
}

test.describe('security headers', () => {
  for (const path of PATHS) {
    test(`${path} carries the modern header set`, async ({ request }) => {
      const res = await request.get(path);
      // A 4xx is acceptable for a path the app doesn't own; a 5xx is not.
      expect(res.status(), `${path} should not 5xx`).toBeLessThan(500);
      assertSecurityHeaders(res);
    });
  }
});
