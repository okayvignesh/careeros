import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AgentService } from './agent.service';

/**
 * D.2: minimal JWT scope guard for `/agent/*` endpoints that the desktop
 * agent (not the browser session) authenticates to. Extracts `Authorization:
 * Bearer <jwt>`, defers all validation to `AgentService.verifyBearer` (which
 * covers signature, expiry, scope, and server-side revocation), then stashes
 * `{ deviceId, userId, sessionId }` on `req.agent` for controllers to read.
 *
 * Ponytail: not a full passport strategy — one guard reads the header, one
 * service does the crypto + DB check, controllers grab `req.agent`. A full
 * `passport-jwt` strategy would add a dep for zero extra safety here.
 */

export interface AgentRequestPayload {
  deviceId: string;
  userId: string;
  sessionId: string;
}

// Augment the Express request so `req.agent` is typed inside controllers.
declare module 'express' {
  interface Request {
    agent?: AgentRequestPayload;
  }
}

@Injectable()
export class AgentJwtGuard implements CanActivate {
  constructor(private readonly agents: AgentService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) throw new UnauthorizedException('Missing bearer token');
    req.agent = await this.agents.verifyBearer(token);
    return true;
  }
}
