import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly session: SessionService,
  ) {}

  @Get('jobs')
  async list(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('skill') skill: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const parsedLimit = Number(limit ?? 50);
    const parsedOffset = Number(offset ?? 0);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
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
  listAdapters(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.jobs.listAdapters();
  }

  @Post('admin/jobs/sync/:adapter')
  @HttpCode(200)
  async sync(@Param('adapter') adapterId: string, @Req() req: Request) {
    this.session.requireUserId(req);
    return this.jobs.sync(adapterId);
  }

  @Post('admin/jobs/extract-skills')
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
  @HttpCode(200)
  async extractSkillsForJob(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.jobs.extractSkillsForJob(userId, id);
  }
}
