import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIp } from '../../common/client-ip';
import { SessionService, type ActiveSessionSummary } from './session.service';
import { RateLimitSessions } from './throttle.decorator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active-session management. Every handler resolves the caller through
 * `SessionService.requireUserId` (401 otherwise) and passes that `userId` into
 * the service, which filters every query by it — so one account can never list
 * or revoke another account's sessions. The current session may revoke others
 * but must use sign-out to end itself.
 *
 * Revocations emit an `auditEvent` row, matching the passkey + password-change
 * paths; the middleware still owns edge revocation of leaked cookies.
 */
@Controller('auth/sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HttpCode(200)
  async list(@Req() req: Request): Promise<ActiveSessionSummary[]> {
    const userId = this.sessions.requireUserId(req);
    return this.sessions.listForUser(userId, this.sessions.read(req)?.sessionId ?? null);
  }

  @Delete(':id')
  @HttpCode(204)
  @RateLimitSessions()
  async revoke(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const userId = this.sessions.requireUserId(req);
    const current = this.sessions.read(req)?.sessionId ?? null;
    if (!UUID_RE.test(id)) throw new NotFoundException('Session not found');
    if (current && id === current) {
      throw new BadRequestException('Sign out to end the current session.');
    }
    await this.sessions.revokeForUser(userId, id);
    await audit(this.prisma, userId, req, 'auth.session.revoked', { sessionId: id });
  }

  @Post('revoke-others')
  @HttpCode(200)
  @RateLimitSessions()
  async revokeOthers(@Req() req: Request): Promise<{ revoked: number }> {
    const userId = this.sessions.requireUserId(req);
    const revoked = await this.sessions.revokeOthersForUser(
      userId,
      this.sessions.read(req)?.sessionId ?? null,
    );
    await audit(this.prisma, userId, req, 'auth.sessions.revoked_others', { revoked });
    return { revoked };
  }
}

async function audit(
  prisma: PrismaService,
  userId: string,
  req: Request,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        userId,
        actor: 'user',
        action,
        resourceType: 'session',
        resourceId: null,
        payload: payload as never,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
      },
    })
    .catch(() => undefined);
}
