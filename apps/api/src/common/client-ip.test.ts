import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { clientIp } from './client-ip';

function req(over: { ip?: string; remoteAddress?: string; headers?: Record<string, string> }): Request {
  return {
    ip: over.ip,
    socket: over.remoteAddress === undefined ? undefined : { remoteAddress: over.remoteAddress },
    headers: over.headers ?? {},
  } as unknown as Request;
}

describe('clientIp', () => {
  it('returns Express req.ip (trust-proxy aware)', () => {
    expect(clientIp(req({ ip: '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores a spoofed x-forwarded-for header', () => {
    expect(clientIp(req({ ip: '203.0.113.7', headers: { 'x-forwarded-for': '1.2.3.4' } }))).toBe('203.0.113.7');
    // MUTATION-SMOKE: if clientIp parsed x-forwarded-for, this returns 1.2.3.4.
  });

  it('falls back to the socket remote address when req.ip is absent', () => {
    expect(clientIp(req({ remoteAddress: '10.0.0.5' }))).toBe('10.0.0.5');
  });

  it("returns 'unknown' when neither is available", () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});
