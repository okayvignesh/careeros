import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { MarketBriefService } from './market-brief.service';

@Controller('me/market-brief')
export class MarketBriefController {
  constructor(
    private readonly briefs: MarketBriefService,
    private readonly session: SessionService,
  ) {}

  @Get('latest')
  async latest(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return (await this.briefs.getLatest(userId)) ?? { empty: true };
  }

  @Post('generate')
  @HttpCode(200)
  async generate(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.briefs.generate(userId);
  }
}
