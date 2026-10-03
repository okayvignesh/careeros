import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MobileService } from './mobile.service';

/**
 * B1 (phase 7 mobile): global bearer-auth bridge for the native client.
 *
 * The web session is a sealed HttpOnly cookie that RN cannot read, while the
 * mobile app holds a `mobile:*` JWT. This middleware verifies that JWT (if the
 * header is present) and attaches `req.mobileAuth`; `SessionService`'s
 * `requireUserId` opts into it as a fallback after the cookie. Net result: the
 * exact same read endpoints the web app uses (`/jobs`, `/me/approvals`,
 * `/brief/*`) serve the phone with no per-controller duplication.
 *
 * Cookie traffic is untouched. A present-but-invalid bearer is left
 * unauthenticated (never a hard fail here) so a stale token cannot take down a
 * cookie-authenticated browser session; protected controllers 401 instead.
 */
@Injectable()
export class MobileAuthMiddleware implements NestMiddleware {
  constructor(private readonly mobile: MobileService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) {
      next();
      return;
    }
    try {
      req.mobileAuth = await this.mobile.verifyBearer(token);
    } catch {
      // Token invalid/expired/revoked: leave unauthenticated.
    }
    next();
  }
}
