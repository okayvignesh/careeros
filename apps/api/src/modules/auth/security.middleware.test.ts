import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { seal } from '@careeros/auth';
import { SecurityMiddleware } from './security.middleware';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  SessionService,
  deriveCsrfToken,
} from './session.service';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET = SECRET;

function fakePrisma(activeIds: string[]) {
  const audits: Array<{ action: string; payload: unknown }> = [];
  return {
    audits,
    activeSession: {
      create: async () => ({}),
      findUnique: async ({ where }: { where: { id: string } }) =>
        activeIds.includes(where.id)
          ? { id: where.id, userId: 'user-1', expiresAt: new Date(Date.now() + 3600_000) }
          : null,
      delete: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    auditEvent: {
      create: async ({ data }: { data: { action: string; payload: unknown } }) => {
        audits.push({ action: data.action, payload: data.payload });
        return {};
      },
    },
  };
}

function makeMiddleware(activeIds: string[]) {
  const prisma = fakePrisma(activeIds);
  const session = new SessionService(prisma as never);
  const mw = new SecurityMiddleware(session, prisma as never);
  return { mw, session, prisma };
}

function makeReq(opts: {
  method?: string;
  path?: string;
  cookies?: Record<string, string>;
  secFetchSite?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  const cookieHeader = opts.cookies
    ? Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    : '';
  return {
    method: opts.method ?? 'POST',
    path: opts.path ?? '/me/usage/pause',
    headers: {
      cookie: cookieHeader,
      ...(opts.secFetchSite ? { 'sec-fetch-site': opts.secFetchSite } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body,
    ip: '1.1.1.1',
  } as unknown as Request;
}

interface FakeRes {
  headers: Record<string, string[]>;
  statusCode: number;
  body: unknown;
  append: (k: string, v: string) => void;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
}

function makeRes(): Response {
  const res: FakeRes = {
    headers: {},
    statusCode: 200,
    body: null,
    append(k, v) {
      (this.headers[k] ??= []).push(v);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res as unknown as Response;
}

describe('SecurityMiddleware CSRF (A-H1)', () => {
  const sessionId = '11111111-2222-4333-8444-555555555555';
  const sealed = seal(
    { userId: 'user-1', createdAt: Date.now(), expiresAt: Date.now() + 3600_000, sessionId } as never,
    SECRET,
  );
  const csrf = deriveCsrfToken(SECRET, sessionId);

  beforeEach(() => vi.clearAllMocks());

  it('accepts a POST with matching cookie + header token and same-origin', async () => {
    const { mw } = makeMiddleware([sessionId]);
    const req = makeReq({
      cookies: { [SESSION_COOKIE_NAME]: sealed, [CSRF_COOKIE_NAME]: csrf },
      secFetchSite: 'same-origin',
      headers: { [CSRF_HEADER_NAME]: csrf },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
  });

  it('rejects a POST with wrong CSRF header (unpatched code would accept)', async () => {
    const { mw, prisma } = makeMiddleware([sessionId]);
    const req = makeReq({
      cookies: { [SESSION_COOKIE_NAME]: sealed, [CSRF_COOKIE_NAME]: csrf },
      secFetchSite: 'same-origin',
      headers: { [CSRF_HEADER_NAME]: 'attacker-supplied' },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw.use(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
    expect(prisma.audits.filter((a) => a.action === 'auth.csrf.rejected')).toHaveLength(1);
    // MUTATION-SMOKE: remove the header-token verification branch in
    // SecurityMiddleware and this test fails (next() is called).
  });

  it('rejects a POST with cross-site Sec-Fetch-Site', async () => {
    const { mw, prisma } = makeMiddleware([sessionId]);
    const req = makeReq({
      cookies: { [SESSION_COOKIE_NAME]: sealed, [CSRF_COOKIE_NAME]: csrf },
      secFetchSite: 'cross-site',
      headers: { [CSRF_HEADER_NAME]: csrf },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw.use(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
    expect(prisma.audits[0].payload).toMatchObject({ reason: 'sec_fetch_site' });
  });

  it('lets GET requests through without CSRF token', async () => {
    const { mw } = makeMiddleware([sessionId]);
    const req = makeReq({
      method: 'GET',
      path: '/me/applications',
      cookies: { [SESSION_COOKIE_NAME]: sealed },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips CSRF token check on /auth/sign-in but still enforces Sec-Fetch-Site', async () => {
    const { mw } = makeMiddleware([]);
    // No cookie yet — this is the bootstrap path.
    const req1 = makeReq({ path: '/auth/sign-in', secFetchSite: 'same-origin' });
    const res1 = makeRes();
    const next1 = vi.fn();
    await mw.use(req1, res1, next1);
    expect(next1).toHaveBeenCalledOnce();

    // Cross-site sign-in POST is still refused.
    const req2 = makeReq({ path: '/auth/sign-in', secFetchSite: 'cross-site' });
    const res2 = makeRes();
    const next2 = vi.fn();
    await mw.use(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect((res2 as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  it('backlog:#70: cross-site POST is allowed when Origin is in TRUSTED_ORIGINS', async () => {
    // Dev topology (web:3000 -> api:3001) is same-site but NOT same-origin,
    // so Sec-Fetch-Site='cross-site' arrives at the api. The operator-managed
    // TRUSTED_ORIGINS allowlist carves that specific origin out; anything
    // else on cross-site still 403s (covered above).
    const origin = 'http://web.dev.local:3000';
    const prevTrusted = process.env.TRUSTED_ORIGINS;
    process.env.TRUSTED_ORIGINS = `${origin},http://other.trusted:3000`;
    try {
      const { mw } = makeMiddleware([sessionId]);
      const req = makeReq({
        cookies: { [SESSION_COOKIE_NAME]: sealed, [CSRF_COOKIE_NAME]: csrf },
        secFetchSite: 'cross-site',
        headers: { [CSRF_HEADER_NAME]: csrf, origin },
      });
      const res = makeRes();
      const next = vi.fn();
      await mw.use(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    } finally {
      if (prevTrusted === undefined) delete process.env.TRUSTED_ORIGINS;
      else process.env.TRUSTED_ORIGINS = prevTrusted;
    }
  });

  it('backlog:#70: cross-site POST with untrusted Origin still 403s', async () => {
    // Guard against a regression where the carve-out is too broad. Same
    // request shape as above but the Origin is NOT in TRUSTED_ORIGINS.
    const prevTrusted = process.env.TRUSTED_ORIGINS;
    process.env.TRUSTED_ORIGINS = 'http://only.this.one:3000';
    try {
      const { mw, prisma } = makeMiddleware([sessionId]);
      const req = makeReq({
        cookies: { [SESSION_COOKIE_NAME]: sealed, [CSRF_COOKIE_NAME]: csrf },
        secFetchSite: 'cross-site',
        headers: { [CSRF_HEADER_NAME]: csrf, origin: 'http://attacker.example:3000' },
      });
      const res = makeRes();
      const next = vi.fn();
      await mw.use(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
      expect(prisma.audits[0].payload).toMatchObject({ reason: 'sec_fetch_site' });
    } finally {
      if (prevTrusted === undefined) delete process.env.TRUSTED_ORIGINS;
      else process.env.TRUSTED_ORIGINS = prevTrusted;
    }
  });

  it('A-H3: revoked sessionId cookie is stripped so downstream sees no session', async () => {
    const { mw } = makeMiddleware([]); // sessionId NOT in active_sessions
    const req = makeReq({
      method: 'GET',
      path: '/me/applications',
      cookies: { [SESSION_COOKIE_NAME]: sealed },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    // Cookie header stripped in-place.
    expect(req.headers.cookie ?? '').not.toContain(SESSION_COOKIE_NAME);
    // Response emits a blanking Set-Cookie so the browser drops it too.
    const setCookies = (res as unknown as { headers: Record<string, string[]> }).headers['Set-Cookie'] ?? [];
    expect(setCookies.join('\n')).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookies.join('\n')).toContain('Max-Age=0');
  });
});
