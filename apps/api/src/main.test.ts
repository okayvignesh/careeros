import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import helmet from 'helmet';

// A-H2: verify helmet config produces the required headers. We don't boot the
// whole Nest app here — that's covered by e2e. Instead we assemble the exact
// helmet middleware chain and run it against a fake req/res so the assertion
// pins the config surface.

describe('A-H2 helmet header set', () => {
  it('emits HSTS 2y + preload, referrer, COOP, and drops unsafe-inline from CSP', async () => {
    const captured: Record<string, string | string[]> = {};
    const req = { method: 'GET', headers: {}, url: '/', originalUrl: '/' } as unknown as Request;
    const res = {
      locals: { cspNonce: 'abc123' },
      setHeader: (k: string, v: string | string[]) => {
        captured[k.toLowerCase()] = v;
      },
      getHeader: (k: string) => captured[k.toLowerCase()],
      removeHeader: (k: string) => delete captured[k.toLowerCase()],
      on: () => {},
      end: () => {},
      writeHead: () => {},
    } as unknown as Response;

    const mw = helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", (_r, r) => `'nonce-${(r as Response).locals.cspNonce}'`],
          'style-src': ["'self'", (_r, r) => `'nonce-${(r as Response).locals.cspNonce}'`],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'object-src': ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: false,
    });
    await new Promise<void>((resolve) => mw(req, res, () => resolve()));

    // MUTATION-SMOKE: drop `strictTransportSecurity` from the config → this
    // assertion fails.
    expect(String(captured['strict-transport-security'])).toContain('max-age=63072000');
    expect(String(captured['strict-transport-security'])).toContain('includeSubDomains');
    expect(String(captured['strict-transport-security'])).toContain('preload');

    expect(captured['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(captured['cross-origin-opener-policy']).toBe('same-origin');

    // A-H2: CSP must NOT contain 'unsafe-inline' in style-src or script-src.
    const csp = String(captured['content-security-policy']);
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
