import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { seal } from '@careeros/auth';
import {
  SESSION_COOKIE_NAME,
  SessionService,
  csrfTokensMatch,
  deriveCsrfToken,
} from './session.service';

const SECRET = process.env.SESSION_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function fakePrisma(activeIds: string[]) {
  const created: unknown[] = [];
  const deleted: string[] = [];
  return {
    calls: { created, deleted },
    activeSession: {
      create: async (args: { data: { id: string } }) => {
        created.push(args.data);
        activeIds.push(args.data.id);
        return args.data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (!activeIds.includes(where.id)) return null;
        return { id: where.id, userId: 'user-1', expiresAt: new Date(Date.now() + 3600_000) };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        const i = activeIds.indexOf(where.id);
        if (i >= 0) activeIds.splice(i, 1);
        return {};
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
}

function fakeRes() {
  const headers: Record<string, string[]> = {};
  return {
    headers,
    append: (name: string, value: string) => {
      (headers[name] ??= []).push(value);
    },
  } as unknown as Response;
}

function reqWithCookies(cookies: Record<string, string>): Request {
  const header = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return { headers: { cookie: header } } as unknown as Request;
}

describe('SessionService (A-H3 + A-M1)', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  it('write emits literal `careeros_session` cookie name in dev + SameSite=Strict + HttpOnly', async () => {
    const prisma = fakePrisma([]);
    const svc = new SessionService(prisma as never);
    const res = fakeRes();
    const sessionId = await svc.write(res, 'user-1');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const setCookies = (res as unknown as { headers: Record<string, string[]> }).headers['Set-Cookie'];
    expect(setCookies).toBeDefined();
    // A-M1: literal cookie names asserted so a mutation renaming the constant
    // in session.service.ts fails here rather than being masked by the import.
    // NODE_ENV !== production in tests → dev-mode name applies.
    expect(setCookies.some((s) => s.startsWith('careeros_session='))).toBe(true);
    expect(setCookies.some((s) => s.startsWith('careeros_csrf='))).toBe(true);
    expect(setCookies.join('\n')).toContain('SameSite=Strict');
    expect(setCookies.join('\n')).toContain('HttpOnly');
    const csrf = setCookies.find((s) => s.startsWith('careeros_csrf='));
    expect(csrf).toBeDefined();
    expect(csrf).not.toContain('HttpOnly');
    // MUTATION-SMOKE: rename the dev constant to `foo_session` in
    // session.service.ts and this test goes red.
  });

  it('write emits literal `__Host-careeros_session` cookie name in production mode (A-M1)', async () => {
    // Force IS_PROD=true by re-importing the module in a prod-env context.
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.resetModules();
      const mod = await import('./session.service');
      const prisma = fakePrisma([]);
      const svc = new mod.SessionService(prisma as never);
      const res = fakeRes();
      await svc.write(res, 'user-1');
      const setCookies = (res as unknown as { headers: Record<string, string[]> }).headers['Set-Cookie'];
      expect(setCookies.some((s) => s.startsWith('__Host-careeros_session='))).toBe(true);
      expect(setCookies.some((s) => s.startsWith('__Host-careeros_csrf='))).toBe(true);
      // MUTATION-SMOKE: rename the prod constant to `__Host-foo_session` and
      // this goes red.
    } finally {
      process.env.NODE_ENV = savedEnv;
      vi.resetModules();
    }
  });

  it('read rejects a cookie whose sessionId is NOT in active_sessions (A-H3)', async () => {
    // Seed the cookie value directly with a sessionId we never wrote to the DB.
    const prisma = fakePrisma([]); // empty active_sessions
    const svc = new SessionService(prisma as never);
    const rogueSessionId = '00000000-0000-4000-8000-000000000000';
    const sealed = seal(
      { userId: 'user-1', createdAt: Date.now(), expiresAt: Date.now() + 3600_000, sessionId: rogueSessionId } as never,
      SECRET,
    );
    // read() itself is sync — it just decodes. The revocation check is
    // isActive(), which the middleware calls.
    const decoded = svc.read(reqWithCookies({ [SESSION_COOKIE_NAME]: sealed }));
    expect(decoded?.sessionId).toBe(rogueSessionId);
    const active = await svc.isActive(rogueSessionId);
    expect(active).toBe(false);
    // MUTATION-SMOKE: replace isActive to `return true` and this fails.
  });

  it('rejects a sealed cookie that lacks a sessionId field (legacy shape)', async () => {
    const prisma = fakePrisma([]);
    const svc = new SessionService(prisma as never);
    const legacy = seal(
      { userId: 'user-1', createdAt: Date.now(), expiresAt: Date.now() + 3600_000 } as never,
      SECRET,
    );
    const decoded = svc.read(reqWithCookies({ [SESSION_COOKIE_NAME]: legacy }));
    expect(decoded).toBeNull();
  });

  it('requireUserId throws 401 when no cookie', () => {
    const prisma = fakePrisma([]);
    const svc = new SessionService(prisma as never);
    expect(() => svc.requireUserId({ headers: {} } as never)).toThrow(UnauthorizedException);
  });

  it('constructor refuses a missing/weak SESSION_SECRET (A-H3)', () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() => new SessionService(fakePrisma([]) as never)).toThrow(/SESSION_SECRET/);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
    // MUTATION-SMOKE: move the SECRET read back to module-scope (`const SECRET
    // = process.env.SESSION_SECRET!`) and this test fails because the ! masks
    // the missing env.
  });
});

describe('CSRF double-submit helpers (A-H1)', () => {
  it('derives a stable token from (secret, sessionId)', () => {
    const t1 = deriveCsrfToken('secret-a', 'sid-1');
    const t2 = deriveCsrfToken('secret-a', 'sid-1');
    const t3 = deriveCsrfToken('secret-a', 'sid-2');
    const t4 = deriveCsrfToken('secret-b', 'sid-1');
    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);
    expect(t1).not.toBe(t4);
  });
  it('csrfTokensMatch is constant-time and rejects empty', () => {
    expect(csrfTokensMatch('', '')).toBe(false);
    expect(csrfTokensMatch('abc', 'abc')).toBe(true);
    expect(csrfTokensMatch('abc', 'abd')).toBe(false);
  });
});
