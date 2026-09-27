import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { StatsService } from './stats.service';

@Controller('me/stats')
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly session: SessionService,
  ) {}

  @Get('dashboard')
  async dashboard(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.stats.dashboardKpis(userId);
  }

  @Get('level')
  async level(@Query('tz') tz: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.stats.levelSummary(userId, tz);
  }

  @Get('recent-evidence')
  async recentEvidence(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.stats.recentEvidence(userId, 5);
  }

  @Get('top-skills')
  async topSkills(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.stats.topSkills(userId, 12);
  }
}
