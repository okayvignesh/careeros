import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { RequireAdmin } from '../../common/decorators/require-admin.decorator';
import { JobsService } from './jobs.service';

/** Pagination hard ceilings shared by the `GET /jobs` listing.
 *  `MAX_LIMIT` matches `JobsService.list`'s server-side clamp so a bad client
 *  gets a 400 with a helpful message instead of silent truncation. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly session: SessionService,
  ) {}

  /**
   * `GET /jobs?limit=<1..200>&offset=<n>&skill=<id>`.
   * Match-score pagination: server sorts a fresh page each call. C-P3.8c doc
   * anchor — the per-page scoring uses the canonical pure `computeMatchResult`
   * from `@careeros/job-pipeline` (the same scorer `POST /matcher/score` uses)
   * over a bounded 2x over-fetch (see JobsService.list ponytail note), so query
   * count per page is constant regardless of pool size. `total` still returns
   * the DB count so the pager can show honest page numbers.
   */
  @Get('jobs')
  async list(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('skill') skill: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const parsedLimit = Number(limit ?? DEFAULT_LIMIT);
    const parsedOffset = Number(offset ?? 0);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }
    if (parsedLimit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be <= ${MAX_LIMIT}`);
    }
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      throw new BadRequestException('offset must be >= 0');
    }
    return this.jobs.list({
      userId,
      limit: parsedLimit,
      offset: parsedOffset,
      ...(skill && skill.trim().length > 0 ? { skill: skill.trim() } : {}),
    });
  }

  @Get('admin/jobs/adapters')
  @RequireAdmin()
  listAdapters(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.jobs.listAdapters();
  }

  @Post('admin/jobs/sync/:adapter')
  @RequireAdmin()
  @HttpCode(200)
  async sync(@Param('adapter') adapterId: string, @Req() req: Request) {
    this.session.requireUserId(req);
    return this.jobs.sync(adapterId);
  }

  @Post('admin/jobs/extract-skills')
  @RequireAdmin()
  @HttpCode(200)
  async extractSkillsBatch(@Query('limit') limit: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const parsedLimit = Number(limit ?? 20);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }
    return this.jobs.extractSkillsBatch(userId, parsedLimit);
  }

  @Post('admin/jobs/:id/extract-skills')
  @RequireAdmin()
  @HttpCode(200)
  async extractSkillsForJob(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.jobs.extractSkillsForJob(userId, id);
  }
}
