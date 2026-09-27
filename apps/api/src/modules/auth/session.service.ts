import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { seal, unseal, type Session } from '@careeros/auth';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'careeros_session';
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 168);
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.SESSION_SECRET!;

@Injectable()
export class SessionService {
  read(req: Request): Session | null {
    const cookieHeader = req.headers.cookie ?? '';
    const raw = parseCookie(cookieHeader, COOKIE_NAME);
    if (!raw) return null;
    return unseal(raw, SECRET);
  }

  write(res: Response, userId: string): void {
    const now = Date.now();
    const session: Session = {
      userId,
      createdAt: now,
      expiresAt: now + TTL_HOURS * 60 * 60 * 1000,
    };
    const sealed = seal(session, SECRET);
    res.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${sealed}; HttpOnly; Path=/; Max-Age=${TTL_HOURS * 3600}; SameSite=Lax${IS_PROD ? '; Secure' : ''}`,
    );
  }

  clear(res: Response): void {
    res.append(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${IS_PROD ? '; Secure' : ''}`,
    );
  }

  requireUserId(req: Request): string {
    const s = this.read(req);
    if (!s) throw new UnauthorizedException('Not signed in');
    return s.userId;
  }
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
