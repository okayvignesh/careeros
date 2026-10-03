import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from '../../common/client-ip';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitAuth } from '../auth/throttle.decorator';
import { SessionService } from '../auth/session.service';
import { MobileService } from './mobile.service';

/**
 * B1 (phase 7 mobile): auth surface for the native app.
 *
 *   POST /mobile/auth/sign-in   public; email + password -> JWT + refresh
 *   POST /mobile/auth/refresh   bearer; rotates the pair (old one dies)
 *   POST /mobile/auth/revoke    bearer; self-revoke the device
 *   GET  /mobile/me             bearer; account identity for Settings
 *
 * Read data (`/jobs`, `/me/approvals`, `/brief/latest`, `/brief/preferences`)
 * is served by the existing controllers: the global `MobileAuthMiddleware`
 * verifies the bearer and `SessionService.requireUserId` accepts it, so there
 * is one implementation of each read path for web and mobile.
 */
@Controller('mobile')
export class MobileController {
  constructor(
    private readonly mobile: MobileService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('auth/sign-in')
  @HttpCode(200)
  @RateLimitAuth()
  async signIn(
    @Req() req: Request,
    @Body() body: { email?: string; password?: string; deviceName?: string; platform?: string },
  ) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password required');
    }
    const out = await this.mobile.signIn({
      email: body.email,
      password: body.password,
      ip: clientIp(req),
      deviceName: body.deviceName?.trim() || 'Mobile',
      ...(body.platform ? { platform: body.platform } : {}),
    });
    return {
      deviceId: out.deviceId,
      userId: out.userId,
      email: out.email,
      jwt: out.jwt,
      refreshToken: out.refreshToken,
      expiresAt: out.expiresAt.toISOString(),
    };
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string; deviceId?: string },
  ) {
    // The access token is intentionally NOT required here: a 1h JWT is usually
    // already expired when the app is reopened, so the refresh token (verified
    // against the AgentSession row + device revocation below) is the authority.
    // When a live access token is present the middleware provides `deviceId`;
    // otherwise the client echoes the deviceId it stored at sign-in.
    // ponytail: deviceId is a client identifier, not a secret; the 48-byte
    // refresh token is the bearer credential.
    const deviceId = req.mobileAuth?.deviceId ?? body?.deviceId;
    if (!deviceId) throw new UnauthorizedException('deviceId required');
    if (!body?.refreshToken) throw new BadRequestException('refreshToken required');
    const out = await this.mobile.refresh(deviceId, body.refreshToken);
    return {
      deviceId: out.deviceId,
      jwt: out.jwt,
      refreshToken: out.refreshToken,
      expiresAt: out.expiresAt.toISOString(),
    };
  }

  @Post('auth/revoke')
  @HttpCode(204)
  async revoke(@Req() req: Request): Promise<void> {
    const auth = req.mobileAuth;
    if (!auth) throw new UnauthorizedException('Missing or invalid token');
    await this.mobile.revoke(auth.deviceId, auth.userId);
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });
    return user ?? { id: userId, email: null, displayName: null };
  }
}
