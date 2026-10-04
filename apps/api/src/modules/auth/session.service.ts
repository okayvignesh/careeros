import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { seal, unseal, type Session } from '@careeros/auth';
import { PrismaService } from '../../prisma/prisma.service';

/** Sealed cookie payload. Superset of the exported `Session` shape; the
 * `sessionId` is required on any session minted after A-H3 and lets the server
 * revoke a leaked cookie without waiting for TTL. */
export interface SealedSession extends Session {
  sessionId: string;
}

/** Row shape returned to the owner of an account by `GET /auth/sessions`.
 * Never carries the sealed cookie or the raw IP — only a masked form. */
export interface ActiveSessionSummary {
  id: string;
  label: string;
  ipMasked: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
}

const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 168);
const IS_PROD = process.env.NODE_ENV === 'production';

// A-M1: session cookie is `__Host-` prefixed whenever we can honor the browser's
// rules for it (Secure + Path=/ + no Domain). In dev-over-HTTP we drop the
// prefix so browsers actually accept the cookie; production always uses the
// prefixed name and Secure=true. The `SESSION_COOKIE_NAME` env override was
// removed on purpose (A-M1).
export const SESSION_COOKIE_NAME = IS_PROD ? '__Host-careeros_session' : 'careeros_session';
export const CSRF_COOKIE_NAME = IS_PROD ? '__Host-careeros_csrf' : 'careeros_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

@Injectable()
export class SessionService {
  // A-H3: read SESSION_SECRET lazily inside the constructor, after
  // runStartupChecks() has proven it is present + strong. Module-load reads
  // masked a missing env with `!`.
  private readonly secret: string;

  constructor(private readonly prisma: PrismaService) {
    const raw = process.env.SESSION_SECRET;
    if (!raw || raw.length < 32) {
      throw new Error(
        'SESSION_SECRET is required and must be >= 32 chars. runStartupChecks() should have refused boot before AuthModule instantiated.',
      );
    }
    this.secret = raw;
  }

  /** Decode the sealed cookie. Sync + DB-free so every controller that already
   * calls this stays sync. Server-side revocation is checked in the
   * SessionRevocationMiddleware (A-H3), which runs before controllers. */
  read(req: Request): SealedSession | null {
    const raw = parseCookie(req.headers.cookie ?? '', SESSION_COOKIE_NAME);
    if (!raw) return null;
    const s = unseal(raw, this.secret) as SealedSession | null;
    if (!s || !s.sessionId) return null;
    return s;
  }

  requireUserId(req: Request): string {
    const s = this.read(req);
    if (s) return s.userId;
    // B1 (phase 7 mobile): the global MobileAuthMiddleware verifies the
    // `mobile:*` bearer and sets `req.mobileAuth`. Cookie-first keeps the web
    // path unchanged while letting every existing read controller serve the
    // native app. Typed structurally to avoid an auth -> mobile import cycle.
    const mobile = (req as Request & { mobileAuth?: { userId: string } }).mobileAuth;
    if (mobile?.userId) return mobile.userId;
    throw new UnauthorizedException('Not signed in');
  }

  /** DB-backed check used by the revocation middleware. Async, but the hot
   * path in controllers goes through `read()` which stays sync. */
  async isActive(sessionId: string): Promise<boolean> {
    const row = await this.prisma.activeSession.findUnique({ where: { id: sessionId } });
    if (!row) return false;
    return row.expiresAt.getTime() > Date.now();
  }

  async write(res: Response, userId: string, meta?: { ip?: string; userAgent?: string }): Promise<string> {
    const now = Date.now();
    const sessionId = randomUUID();
    const expiresAt = now + TTL_HOURS * 60 * 60 * 1000;
    const session: SealedSession = {
      userId,
      createdAt: now,
      expiresAt,
      sessionId,
    };
    await this.prisma.activeSession.create({
      data: {
        id: sessionId,
        userId,
        issuedAt: new Date(now),
        expiresAt: new Date(expiresAt),
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });
    const sealed = seal(session as Session, this.secret);
    const csrf = deriveCsrfToken(this.secret, sessionId);

    // A-H1 + A-M1: session cookie is SameSite=Strict + HttpOnly + Path=/, and
    // uses the `__Host-` prefix in prod (Secure required). CSRF cookie shares
    // scope so the double-submit works but is NOT HttpOnly — the SPA reads it
    // and echoes it back in the `x-csrf-token` header.
    res.append('Set-Cookie', formatCookie(SESSION_COOKIE_NAME, sealed, { httpOnly: true }));
    res.append('Set-Cookie', formatCookie(CSRF_COOKIE_NAME, csrf, { httpOnly: false }));
    return sessionId;
  }

  async clear(res: Response, req?: Request): Promise<void> {
    if (req) {
      const s = this.read(req);
      if (s?.sessionId) {
        await this.prisma.activeSession
          .delete({ where: { id: s.sessionId } })
          .catch(() => undefined);
      }
    }
    res.append('Set-Cookie', expireCookie(SESSION_COOKIE_NAME, true));
    res.append('Set-Cookie', expireCookie(CSRF_COOKIE_NAME, false));
  }

  /** A-H3: revoke every active session for a user. Called from the password
   * change path in the same transaction as the hash update. Returns count so
   * the caller can log it. */
  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.activeSession.deleteMany({ where: { userId } });
    return res.count;
  }

  /** List the caller's own active sessions. Scoped by `userId` at the query
   * level so a stolen session id from another account can never be enumerated.
   * `currentSessionId` only marks the row used by this request; it does not
   * widen the query. */
  async listForUser(userId: string, currentSessionId: string | null): Promise<ActiveSessionSummary[]> {
    const rows = await this.prisma.activeSession.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: describeUserAgent(row.userAgent),
      ipMasked: maskIp(row.ip),
      createdAt: row.issuedAt,
      // ponytail: no dedicated last-activity column. `issuedAt` doubles as the
      // only honest timestamp we have: touching it on every request would let a
      // live cookie escape password-change revocation, which deletes rows with
      // `issuedAt < resetAt` (see AuthService.changePassword).
      lastSeenAt: row.issuedAt,
      expiresAt: row.expiresAt,
      current: row.id === currentSessionId,
    }));
  }

  /** Revoke one session the caller owns. The `userId` in the where clause is
   * the authorization boundary: zero rows deleted means either unknown or
   * someone else's session, and both surface as 404 (no enumeration oracle). */
  async revokeForUser(userId: string, sessionId: string): Promise<void> {
    const res = await this.prisma.activeSession.deleteMany({ where: { id: sessionId, userId } });
    if (res.count === 0) throw new NotFoundException('Session not found');
  }

  /** Revoke every session for the user except the one making the request. */
  async revokeOthersForUser(userId: string, currentSessionId: string | null): Promise<number> {
    const res = await this.prisma.activeSession.deleteMany({
      where: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
    });
    return res.count;
  }

  /** A-H1 support: derive the expected CSRF token for a given sessionId so
   * middleware / tests can verify without hitting the DB. */
  expectedCsrf(sessionId: string): string {
    return deriveCsrfToken(this.secret, sessionId);
  }
}

function formatCookie(name: string, value: string, opts: { httpOnly: boolean }): string {
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${TTL_HOURS * 3600}`, 'SameSite=Strict'];
  if (opts.httpOnly) parts.push('HttpOnly');
  // __Host- prefix mandates Secure; in dev-over-HTTP the prefix is dropped so
  // Secure is optional there. We still emit Secure in prod even without the
  // prefix in case a deployment renames the cookie.
  if (IS_PROD || name.startsWith('__Host-')) parts.push('Secure');
  return parts.join('; ');
}

function expireCookie(name: string, httpOnly: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (IS_PROD || name.startsWith('__Host-')) parts.push('Secure');
  return parts.join('; ');
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** A-H1: double-submit token. HMAC(SESSION_SECRET, sessionId) => base64url. Same
 * secret + same sessionId always yields the same token, so the server can
 * re-derive on every request without needing extra storage. */
export function deriveCsrfToken(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

/** Constant-time compare. Both strings must be non-empty. */
export function csrfTokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** Best-effort device label from a User-Agent. Order matters: Edge/Opera UAs
 * also contain `Chrome`, and every Chromium UA contains `Safari`. No dep, no
 * pretense of exact detection — falls back to the UA head, then a placeholder. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

/** Keep the network private: mask the host portion of an IP before it leaves
 * the API. `203.0.113.7` -> `203.0.113.x`; IPv6 keeps two hextets. */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(':')) {
    const [a = '', b = ''] = ip.split(':');
    return `${a}:${b}:****`;
  }
  const octets = ip.split('.');
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
  return ip;
}
