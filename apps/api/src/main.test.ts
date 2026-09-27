import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { PERMISSIONS_POLICY, buildSecurityMiddleware } from './main';

// A-H2: asserts against the SAME middleware chain that bootstrap() installs.
// If someone silently flips `strictTransportSecurity: false` in main.ts or
// drops the Permissions-Policy setter, the assertions here go red.

async function runChain(): Promise<Record<string, string | string[]>> {
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

  const chain = buildSecurityMiddleware();
  for (const mw of chain) {
    // Overwrite the nonce so downstream helmet emits a deterministic value.
    (res as unknown as { locals: { cspNonce: string } }).locals.cspNonce = 'abc123';
    await new Promise<void>((resolve, reject) => {
      try {
        (mw as unknown as (r: Request, s: Response, n: (e?: unknown) => void) => void)(
          req,
          res,
          (err?: unknown) => (err ? reject(err) : resolve()),
        );
      } catch (e) {
        reject(e);
      }
    });
  }
  return captured;
}

describe('A-H2 buildSecurityMiddleware', () => {
  it('emits HSTS 2y + preload, referrer, COOP, and drops unsafe-inline from CSP', async () => {
    const captured = await runChain();

    // MUTATION-SMOKE: setting `strictTransportSecurity: false` in
    // buildSecurityMiddleware makes this assertion red.
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

  it('emits Permissions-Policy from the exported constant', async () => {
    const captured = await runChain();
    // MUTATION-SMOKE: drop the `permissions` middleware from the chain and
    // this assertion goes red.
    expect(captured['permissions-policy']).toBe(PERMISSIONS_POLICY);
    expect(String(captured['permissions-policy'])).toContain('camera=()');
    expect(String(captured['permissions-policy'])).toContain('geolocation=()');
  });
});
