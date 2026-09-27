import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreateAccountSchema, SignInSchema, type CreateAccountInput, type SignInInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Post('sign-up')
  @HttpCode(201)
  async signUp(
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Single-user rule for MVP: only allowed when no user exists yet.
    const existing = await this.auth.userCount();
    if (existing > 0) {
      throw new ForbiddenException('Account already exists. Sign in instead.');
    }
    const user = await this.auth.createUser(body.email, body.password, body.displayName);
    this.session.write(res, user.id);
    return { id: user.id, email: user.email };
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(SignInSchema)) body: SignInInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.verifyCredentials(body.email, body.password);
    this.session.write(res, user.id);
    return { id: user.id, email: user.email };
  }

  @Post('sign-out')
  @HttpCode(204)
  signOut(@Res({ passthrough: true }) res: Response) {
    this.session.clear(res);
  }

  @Post('me')
  @HttpCode(200)
  me(@Req() req: Request) {
    const s = this.session.read(req);
    return s ? { userId: s.userId, expiresAt: s.expiresAt } : null;
  }
}
