import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RecoveryCodesService } from './recovery.service';
import { SessionService } from './session.service';
import { RateLimitAuth } from './throttle.decorator';

/**
 * C-P0.7: recovery-code endpoints.
 *   POST /auth/recovery/generate  (auth + fresh re-auth) — mints 8 codes,
 *                                 returns plaintext once, persists sha256s.
 *   POST /auth/recovery/redeem    (public) — email + code, mints session.
 *
 * Fresh re-auth guard: the C-P0.3 `hasFreshReauth` helper is not merged
 * yet — until it lands, we approximate with a session-age check
 * (< 5 min since createdAt). This matches security.md item 106.
 * TODO(C-P0.3): replace with the shared guard once C-P0.3 lands.
 */
const FRESH_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

@Controller('auth/recovery')
export class RecoveryCodesController {
  constructor(
    private readonly codes: RecoveryCodesService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('generate')
  @HttpCode(201)
  @RateLimitAuth()
  async generate(@Req() req: Request, @Body() body: { count?: number }) {
    const sealed = this.session.read(req);
    if (!sealed) throw new ForbiddenException('Not signed in');
    // TODO(C-P0.3): swap for shared hasFreshReauth() when it lands.
    const age = Date.now() - sealed.createdAt;
    if (age > FRESH_REAUTH_MAX_AGE_MS) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    const count = clampCount(body?.count);
    const out = await this.codes.generateCodes(sealed.userId, count);
    await audit(this.prisma, sealed.userId, req, 'auth.recovery.generated', { count: out.codes.length });
    return out;
  }

  @Post('redeem')
  @HttpCode(200)
  @RateLimitAuth()
  async redeem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { email: string; code: string },
  ) {
    if (!body?.email || !body?.code) {
      throw new ForbiddenException('email + code required');
    }
    try {
      const out = await this.codes.redeemCode(body.email, body.code, res, requestMeta(req));
      await audit(this.prisma, out.userId, req, 'auth.recovery.redeemed.ok', { email: body.email });
      return { userId: out.userId };
    } catch (e) {
      await audit(this.prisma, null, req, 'auth.recovery.redeemed.fail', {
        email: body.email,
        reason: (e as Error).message,
      });
      throw e;
    }
  }
}

function clampCount(n: unknown): number {
  const parsed = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 8;
  if (parsed < 1) return 1;
  if (parsed > 16) return 16;
  return parsed;
}

function requestIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function requestMeta(req: Request): { ip: string; userAgent: string } {
  return { ip: requestIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) };
}

async function audit(
  prisma: PrismaService,
  userId: string | null,
  req: Request,
  action: string,
  payload: Record<string, unknown> | null,
): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        userId,
        actor: userId ? 'user' : 'system',
        action,
        resourceType: 'recovery_code',
        resourceId: null,
        payload: (payload ?? undefined) as never,
        ip: requestIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
      },
    })
    .catch(() => undefined);
}
