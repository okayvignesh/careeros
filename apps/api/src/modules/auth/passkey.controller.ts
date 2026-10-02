import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types';
import { PasskeyService } from './passkey.service';
import { SessionService } from './session.service';
import { RateLimitAuth } from './throttle.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIp } from '../../common/client-ip';

/**
 * C-P0.7: passkey endpoints. Register endpoints require an existing session;
 * login endpoints are public and mint a session on success. Audit rows are
 * emitted for every success + fail path so security.md item 3 is tickable.
 */
@Controller('auth/passkey')
export class PasskeyController {
  constructor(
    private readonly passkeys: PasskeyService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register/options')
  @HttpCode(200)
  @RateLimitAuth()
  async registerOptions(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.passkeys.generateRegistrationOptions(userId);
  }

  @Post('register/verify')
  @HttpCode(201)
  @RateLimitAuth()
  async registerVerify(
    @Req() req: Request,
    @Body() body: { response: RegistrationResponseJSON; name?: string },
  ) {
    const userId = this.session.requireUserId(req);
    try {
      const out = await this.passkeys.verifyRegistration(userId, body.response, body.name);
      await audit(this.prisma, userId, req, 'auth.passkey.register.ok', { credentialId: out.credentialId });
      return out;
    } catch (e) {
      await audit(this.prisma, userId, req, 'auth.passkey.register.fail', { reason: (e as Error).message });
      throw e;
    }
  }

  @Post('login/options')
  @HttpCode(200)
  @RateLimitAuth()
  async loginOptions(@Body() body: { userId?: string }) {
    // Public endpoint. `userId` is optional (usernameless auth); when
    // provided we narrow the allow-list. The browser-side flow may prefer
    // discoverable credentials with no hint.
    return this.passkeys.generateAuthenticationOptions(body?.userId);
  }

  @Post('login/verify')
  @HttpCode(200)
  @RateLimitAuth()
  async loginVerify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { response: AuthenticationResponseJSON },
  ) {
    try {
      const out = await this.passkeys.verifyAuthentication(body.response, res, requestMeta(req));
      await audit(this.prisma, out.userId, req, 'auth.passkey.login.ok', null);
      return { userId: out.userId };
    } catch (e) {
      await audit(this.prisma, null, req, 'auth.passkey.login.fail', { reason: (e as Error).message });
      throw e;
    }
  }

  @Get('credentials')
  @HttpCode(200)
  async listCredentials(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.passkeys.listCredentials(userId);
  }

  @Delete('credentials/:id')
  @HttpCode(204)
  async revokeCredential(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.passkeys.revokeCredential(userId, id);
    await audit(this.prisma, userId, req, 'auth.passkey.revoke', { credentialId: id });
  }
}

function requestMeta(req: Request): { ip: string; userAgent: string } {
  return { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) };
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
        resourceType: 'passkey',
        resourceId: null,
        payload: (payload ?? undefined) as never,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
      },
    })
    .catch(() => undefined);
}
