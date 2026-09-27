import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GithubConnectSchema, type GithubConnectInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { GithubService } from './github/github.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly github: GithubService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const rows = await this.prisma.integration.findMany({
      where: { userId },
      select: { kind: true, status: true, connectedAt: true, metadata: true },
    });
    return rows.map((r) => ({
      kind: r.kind,
      status: r.status,
      connectedAt: r.connectedAt.toISOString(),
      metadata: r.metadata as Record<string, unknown> | null,
    }));
  }

  @Post('github')
  @HttpCode(201)
  async connectGithub(
    @Body(new ZodValidationPipe(GithubConnectSchema)) body: GithubConnectInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.github.saveToken(userId, body.token);
  }

  @Delete('github')
  @HttpCode(204)
  async disconnectGithub(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.github.disconnect(userId);
  }

  @Post('github/resync')
  @HttpCode(202)
  async resyncGithub(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.github.resync(userId, 'manual');
    return { queued: true };
  }

  @Get('github/contributions')
  async contributions(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.github.getContributions(userId);
  }
}
