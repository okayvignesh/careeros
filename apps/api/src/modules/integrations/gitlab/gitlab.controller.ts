// GitLab connect/disconnect/resync routes. Mirrors integrations.controller
// (github). Kept as a separate controller so path prefixes (`integrations/gitlab/...`)
// are obvious in route listings and so the parallel-session settings revamp
// can bolt its UI without merging into the shared controller.
import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SessionService } from '../../auth/session.service';
import { GitlabService } from './gitlab.service';

// PAT payload. `baseUrl` is optional (defaults to gitlab.com). `allowlistOptIn`
// gates writes to any host other than gitlab.com per Wave A A-C2 / A-H6b.
// URL shape checking is done inside the service via `assertPublicUrl` — the
// zod schema deliberately does NOT run assertPublicUrlShape here so the audit
// event lands on the SSRF-reject path (visible to the operator).
const GitlabConnectSchema = z.object({
  pat: z.string().min(20).max(500),
  baseUrl: z.string().url().max(500).optional(),
  allowlistOptIn: z.boolean().optional(),
});
type GitlabConnectInput = z.infer<typeof GitlabConnectSchema>;

@Controller('integrations/gitlab')
export class GitlabController {
  constructor(
    private readonly gitlab: GitlabService,
    private readonly session: SessionService,
  ) {}

  @Post('connect')
  @HttpCode(201)
  async connect(
    @Body(new ZodValidationPipe(GitlabConnectSchema)) body: GitlabConnectInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.gitlab.saveToken(userId, {
      pat: body.pat,
      baseUrl: body.baseUrl ?? null,
      allowlistOptIn: body.allowlistOptIn ?? false,
    });
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.gitlab.disconnect(userId);
  }

  @Post('resync')
  @HttpCode(202)
  async resync(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.gitlab.resync(userId, 'manual');
    return { queued: true };
  }

  @Get('probe')
  async probe(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.gitlab.probe(userId);
  }
}
