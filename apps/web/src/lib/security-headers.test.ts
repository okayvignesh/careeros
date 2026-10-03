import { afterEach, describe, expect, it, vi } from 'vitest';
import { HSTS_VALUE, STATIC_SECURITY_HEADERS, buildCsp } from './security-headers';

afterEach(() => vi.unstubAllEnvs());

describe('buildCsp', () => {
  it('is nonce-based with no inline/eval scripts in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = buildCsp('abc123', 'https://api.example.test');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://api.example.test');

    const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('relaxes script-src in development so HMR can run', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = buildCsp('xyz');
    const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'unsafe-inline'");
  });
});

describe('static security headers', () => {
  it('ships the plan/security.md item 2 baseline', () => {
    expect(HSTS_VALUE).toMatch(/max-age=63072000/);
    expect(STATIC_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(STATIC_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(STATIC_SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    const permissions = STATIC_SECURITY_HEADERS['Permissions-Policy'] ?? '';
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('geolocation=()');
    expect(permissions).toContain('usb=()');
  });
});
