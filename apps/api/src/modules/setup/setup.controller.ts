import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  CreateAccountSchema,
  ProviderConfigSchema,
  EmbeddingConfigSchema,
  GithubConnectSchema,
  CareerGoalsSchema,
  type CreateAccountInput,
  type ProviderConfigInput,
  type EmbeddingConfigInput,
  type GithubConnectInput,
  type CareerGoalsInput,
} from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { RateLimitAuth } from '../auth/throttle.decorator';
import { ProvidersService } from '../providers/providers.service';
import { EmbeddingsService, type TestResult } from '../embeddings/embeddings.service';
import { GithubService } from '../integrations/github/github.service';
import { GoalsService } from '../goals/goals.service';
import { RecoveryService } from '../recovery/recovery.service';
import { HealthService, type HealthResponse } from '../health/health.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SetupService } from './setup.service';

// A-M2: single global advisory lock key for the "create the first account"
// transaction. Any concurrent POST /setup/account serializes on this.
const SETUP_ACCOUNT_ADVISORY_KEY = 1;

@Controller('setup')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly auth: AuthService,
    private readonly session: SessionService,
    private readonly providers: ProvidersService,
    private readonly embeddings: EmbeddingsService,
    private readonly github: GithubService,
    private readonly goals: GoalsService,
    private readonly recovery: RecoveryService,
    private readonly health: HealthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('state')
  state() {
    return this.setup.getState();
  }

  @Post('account')
  @HttpCode(201)
  @RateLimitAuth() // A-C1: 5/min per IP on the setup account endpoint too.
  async account(
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // A-M2: wrap the whole create in a transaction with an advisory lock so
    // two concurrent POSTs serialize (only one can pass the `userCount === 0`
    // check + create). On a unique-constraint hit we return a generic 409 that
    // does NOT hint whether the email exists (enumeration guard).
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ACCOUNT_ADVISORY_KEY})`;
        const existing = await tx.user.count();
        if (existing > 0) {
          throw new ForbiddenException('Account already exists. Sign in instead.');
        }
        const { hashPassword } = await import('@careeros/auth');
        const passwordHash = await hashPassword(body.password);
        return tx.user.create({
          data: {
            email: body.email.normalize('NFC').toLowerCase(),
            displayName: body.displayName ?? null,
            passwordHash,
            setupState: { create: { state: 'account_created' } },
          },
          select: { id: true, email: true, displayName: true },
        });
      });
      await this.session.write(res, user.id, {
        ip: (req.ip ?? 'unknown').toString(),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512),
      });
      return { id: user.id, email: user.email };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // A-M2: never reveal which field collided.
        throw new ConflictException('Setup already completed.');
      }
      throw e;
    }
  }

  @Post('provider')
  @HttpCode(201)
  async provider(
    @Body(new ZodValidationPipe(ProviderConfigSchema)) body: ProviderConfigInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const cfg = await this.providers.saveProvider(userId, body);
    await this.setup.advance(userId, 'provider_configured');
    return cfg;
  }

  @Post('provider/probe')
  @HttpCode(200)
  async probe(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const result = await this.providers.probe(userId);
    const allOk = Object.values(result).every((r) => r.ok);
    if (allOk) await this.setup.advance(userId, 'provider_verified');
    return result;
  }

  @Post('embedding')
  @HttpCode(201)
  async embedding(
    @Body(new ZodValidationPipe(EmbeddingConfigSchema)) body: EmbeddingConfigInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    await this.embeddings.saveConfig(body);
    await this.setup.advance(userId, 'embedding_configured');
    return { ok: true };
  }

  @Post('embedding/test')
  @HttpCode(200)
  async embeddingTest(@Req() req: Request): Promise<TestResult> {
    const userId = this.session.requireUserId(req);
    const result = await this.embeddings.test();
    if (result.qdrantReachable && result.upsertOk && result.searchOk) {
      await this.setup.advance(userId, 'embedding_verified');
    }
    return result;
  }

  @Post('github')
  @HttpCode(201)
  async connectGithub(
    @Body(new ZodValidationPipe(GithubConnectSchema)) body: GithubConnectInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const profile = await this.github.saveToken(userId, body.token);
    await this.setup.advance(userId, 'github_connected');
    return profile;
  }

  @Post('integrations/reviewed')
  @HttpCode(200)
  async integrationsReviewed(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.setup.advance(userId, 'integrations_reviewed');
    return { ok: true };
  }

  @Post('resume/confirm')
  @HttpCode(200)
  async resumeConfirm(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.setup.advance(userId, 'facts_reviewed');
    return { ok: true };
  }

  @Post('goals')
  @HttpCode(201)
  async saveGoals(
    @Body(new ZodValidationPipe(CareerGoalsSchema)) body: CareerGoalsInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    await this.goals.save(userId, body);
    await this.setup.advance(userId, 'goals_set');
    return { ok: true };
  }

  @Post('health/verify')
  @HttpCode(200)
  async verifyHealth(@Req() req: Request): Promise<HealthResponse> {
    const userId = this.session.requireUserId(req);
    const result = await this.health.check();
    if (result.status === 'ok') {
      await this.setup.advance(userId, 'health_verified');
    }
    return result;
  }

  @Post('recovery/acknowledge')
  @HttpCode(204)
  async acknowledgeRecovery(@Req() req: Request): Promise<void> {
    const userId = this.session.requireUserId(req);
    await this.recovery.acknowledge(userId);
    await this.setup.advance(userId, 'recovery_acknowledged');
  }

  @Post('complete')
  @HttpCode(200)
  async complete(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.setup.advance(userId, 'complete');
    return { ok: true };
  }
}
