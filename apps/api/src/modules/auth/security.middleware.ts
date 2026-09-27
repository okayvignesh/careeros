import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  SessionService,
  csrfTokensMatch,
} from './session.service';

/**
 * Runs on every request. Two jobs:
 *
 *  A-H1 (CSRF): non-GET requests must carry a valid double-submit token AND a
 *  `Sec-Fetch-Site` of `same-origin` or `none`. Auth entry endpoints
 *  (sign-in / sign-up / setup/account) are exempt because the client has no
 *  cookie yet — for those the rate-limit + strict `Sec-Fetch-Site` check is
 *  the defense.
 *
 *  A-H3 (revocation): any request that carries a sealed session cookie has its
 *  `sessionId` looked up in `active_sessions`; if missing/expired the cookie
 *  is treated as invalid — we clear it and let the request proceed as
 *  unauthenticated (controllers that call `requireUserId` will 401).
 */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  constructor(
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const method = req.method.toUpperCase();
    const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

    // A-H3: revoke leaked cookies at the edge. We do this on every request
    // (cheap indexed lookup) so controllers stay sync.
    const sealed = this.session.read(req);
    if (sealed?.sessionId) {
      const active = await this.session.isActive(sealed.sessionId);
      if (!active) {
        // Clear the cookie so the browser stops sending it.
        this.blankCookie(res, SESSION_COOKIE_NAME);
        this.blankCookie(res, CSRF_COOKIE_NAME);
        // Strip the cookie header so downstream `SessionService.read` returns null.
        stripCookies(req, [SESSION_COOKIE_NAME, CSRF_COOKIE_NAME]);
      }
    }

    if (isMutation) {
      // A-H1a: Sec-Fetch-Site must be same-origin OR none (top-level nav).
      const secFetch = req.headers['sec-fetch-site'];
      if (secFetch && secFetch !== 'same-origin' && secFetch !== 'none') {
        await this.auditCsrfReject(sealed?.userId ?? null, req, 'sec_fetch_site', String(secFetch));
        res.status(403).json({ statusCode: 403, message: 'CSRF check failed (origin)' });
        return;
      }

      // A-H1b: double-submit token. Skip only for the initial auth endpoints
      // (no session yet) which are locked down by rate-limit + Sec-Fetch-Site.
      if (!isAuthBootstrap(req.path) && sealed?.sessionId) {
        const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
        const headerToken =
          (req.headers[CSRF_HEADER_NAME] as string | undefined) ??
          ((req.body as Record<string, unknown> | undefined)?.__csrf as string | undefined);
        const expected = this.session.expectedCsrf(sealed.sessionId);
        if (!cookieToken || !headerToken || !csrfTokensMatch(cookieToken, expected) || !csrfTokensMatch(headerToken, expected)) {
          await this.auditCsrfReject(sealed.userId, req, 'token_mismatch');
          res.status(403).json({ statusCode: 403, message: 'CSRF check failed (token)' });
          return;
        }
      }
    }
    next();
  }

  private blankCookie(res: Response, name: string): void {
    const secure = process.env.NODE_ENV === 'production' || name.startsWith('__Host-');
    res.append(
      'Set-Cookie',
      `${name}=; Path=/; Max-Age=0; SameSite=Strict${secure ? '; Secure' : ''}${
        name === SESSION_COOKIE_NAME ? '; HttpOnly' : ''
      }`,
    );
  }

  private async auditCsrfReject(
    userId: string | null,
    req: Request,
    reason: string,
    detail?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'system',
          action: 'auth.csrf.rejected',
          resourceType: 'request',
          resourceId: `${req.method} ${req.path}`,
          payload: { reason, detail: detail ?? null },
          ip: req.ip ?? null,
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
        },
      });
    } catch {
      // ponytail: audit write best-effort; reject already went out.
    }
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function stripCookies(req: Request, names: string[]): void {
  const header = req.headers.cookie;
  if (!header) return;
  const kept = header
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      const [k] = s.split('=');
      return !names.includes(k);
    })
    .join('; ');
  req.headers.cookie = kept;
}

function isAuthBootstrap(path: string): boolean {
  // First-contact endpoints where the client legitimately has no cookie yet.
  // These are protected by @nestjs/throttler (A-C1) + strict Sec-Fetch-Site.
  return (
    path === '/auth/sign-in' ||
    path === '/auth/sign-up' ||
    path === '/setup/account'
  );
}
