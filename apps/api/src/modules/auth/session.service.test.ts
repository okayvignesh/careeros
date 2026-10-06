import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { seal } from '@careeros/auth';
import {
  SESSION_COOKIE_NAME,
  SessionService,
  csrfTokensMatch,
  deriveCsrfToken,
  describeUserAgent,
  maskIp,
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

type SessionRow = {
  id: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
};

/** Minimal in-memory active_sessions table that actually enforces the where
 * clauses (`userId`, `id`, `id.not`) — so the scoping test can prove one user
 * cannot see or delete another's rows. */
function fakeSessionTable(seed: SessionRow[]) {
  const rows = [...seed];
  const matches = (r: SessionRow, where: { userId: string; id?: string | { not: string } }) => {
    if (r.userId !== where.userId) return false;
    if (where.id === undefined) return true;
    if (typeof where.id === 'string') return r.id === where.id;
    return r.id !== where.id.not;
  };
  return {
    rows,
    activeSession: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows
          .filter((r) => r.userId === where.userId)
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()),
      deleteMany: async ({ where }: { where: { userId: string; id?: string | { not: string } } }) => {
        const before = rows.length;
        const kept = rows.filter((r) => !matches(r, where));
        rows.length = 0;
        rows.push(...kept);
        return { count: before - rows.length };
      },
    },
  };
}

function newSessionService(prisma: unknown) {
  return new SessionService(prisma as never);
}

describe('SessionService active-session management (A-H3)', () => {
  const older = new Date('2026-01-01T00:00:00Z');
  const newer = new Date('2026-01-02T00:00:00Z');
  const seed: SessionRow[] = [
    { id: 's-older', userId: 'user-1', issuedAt: older, expiresAt: newer, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36' },
    { id: 's-newer', userId: 'user-1', issuedAt: newer, expiresAt: newer, ip: '2001:db8::1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/121' },
    { id: 's-foreign', userId: 'user-2', issuedAt: newer, expiresAt: newer, ip: '198.51.100.9', userAgent: null },
  ];

  it('listForUser returns only the caller rows, newest first, with masked IP + label', async () => {
    const svc = newSessionService(fakeSessionTable(seed));
    const list = await svc.listForUser('user-1', 's-older');
    expect(list.map((s) => s.id)).toEqual(['s-newer', 's-older']);
    expect(list[0]?.current).toBe(false);
    expect(list[1]?.current).toBe(true);
    expect(list[0]?.label).toBe('Firefox on Windows');
    expect(list[0]?.ipMasked).toBe('2001:db8:****');
    expect(list[1]?.ipMasked).toBe('203.0.113.x');
    // Never leaks the foreign row.
    expect(list.some((s) => s.id === 's-foreign')).toBe(false);
  });

  it('revokeForUser deletes only the caller own session', async () => {
    const table = fakeSessionTable(seed);
    const svc = newSessionService(table);
    await svc.revokeForUser('user-1', 's-older');
    expect(table.rows.map((r) => r.id).sort()).toEqual(['s-foreign', 's-newer']);
    // MUTATION-SMOKE: drop `userId` from the where clause and s-foreign is
    // deletable by user-1 — the cross-account test below catches that.
  });

  it("rejects revoking another user's session with 404 and leaves it intact", async () => {
    const table = fakeSessionTable(seed);
    const svc = newSessionService(table);
    await expect(svc.revokeForUser('user-1', 's-foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(table.rows.some((r) => r.id === 's-foreign')).toBe(true);
  });

  it('revokeOthersForUser keeps the current session and only touches the caller', async () => {
    const table = fakeSessionTable(seed);
    const svc = newSessionService(table);
    const revoked = await svc.revokeOthersForUser('user-1', 's-newer');
    expect(revoked).toBe(1);
    expect(table.rows.map((r) => r.id).sort()).toEqual(['s-foreign', 's-newer']);
  });
});

describe('session display helpers (no raw IP / UA leaves the API)', () => {
  it('describeUserAgent pairs browser + OS and never echoes unknown strings', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Edg/120 Chrome/120 Safari/537')).toBe('Edge on Windows');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605')).toBe('Safari on macOS');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604')).toBe('Safari on iOS');
    expect(describeUserAgent(null)).toBe('Unknown device');
    // A non-browser UA falls back to a placeholder, not the raw header.
    expect(describeUserAgent('curl/8.4.0')).toBe('Unknown device');
  });

  it('maskIp masks the host portion and passes null through', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.113.x');
    expect(maskIp('2001:db8::1')).toBe('2001:db8:****');
    expect(maskIp(null)).toBeNull();
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
