import { Body, ConflictException, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { CreateAccountSchema, SignInSchema, type CreateAccountInput, type SignInInput } from '@careeros/shared';
import { clientIp } from '../../common/client-ip';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { RateLimitAuth } from './throttle.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Post('sign-up')
  @HttpCode(201)
  @RateLimitAuth() // A-C1: 5/min per IP; same envelope as sign-in.
  async signUp(
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      // Single-user rule for MVP: createUser wraps the count + insert in one
      // transaction behind the shared first-account advisory lock.
      const user = await this.auth.createUser(body.email, body.password, body.displayName);
      await this.session.write(res, user.id, requestMeta(req));
      return { id: user.id, email: user.email };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Never reveal which field collided (email-enumeration guard).
        throw new ConflictException('Account already exists. Sign in instead.');
      }
      throw e;
    }
  }

  @Post('sign-in')
  @HttpCode(200)
  @RateLimitAuth() // A-C1: 5/min per IP + exponential lockout inside AuthService.
  async signIn(
    @Body(new ZodValidationPipe(SignInSchema)) body: SignInInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = clientIp(req);
    const user = await this.auth.verifyCredentialsWithLockout(body.email, body.password, ip);
    await this.session.write(res, user.id, requestMeta(req));
    return { id: user.id, email: user.email };
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.session.clear(res, req);
  }

  @Post('me')
  @HttpCode(200)
  me(@Req() req: Request) {
    const s = this.session.read(req);
    return s ? { userId: s.userId, expiresAt: s.expiresAt } : null;
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // A-H3: verifies old password, updates hash, then revokes ALL sessions
    // for the user (including the current one). Client must sign in again.
    const userId = this.session.requireUserId(req);
    await this.auth.changePassword(userId, body.currentPassword, body.newPassword);
    await this.session.clear(res, req);
  }
}

function requestMeta(req: Request): { ip: string; userAgent: string } {
  return { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) };
}
