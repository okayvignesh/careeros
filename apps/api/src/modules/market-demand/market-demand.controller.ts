// C-P3.5 follow-up: user-facing market-demand endpoints backing screens 33/34.
//
//   GET /me/market/skill-demand?window=<days>  - top skills in the caller's
//                                                preference-filtered job pool
//   GET /me/market/trends                      - rising/steady/declining
//                                                technology signals
//
// Both require an authenticated session and are derived from persisted
// `NormalizedJob` rows (no fixture, no invented numbers). An empty pool is a
// valid 200 with an empty `rows`/`signals` array, never an error.
import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SessionService } from '../auth/session.service';
import {
  DEMAND_DEFAULT_WINDOW_DAYS,
  DEMAND_MAX_WINDOW_DAYS,
  DEMAND_MIN_WINDOW_DAYS,
  MarketDemandService,
} from './market-demand.service';

/** Parse + clamp `?window=<days>`. Invalid input is a 400, never a silent
 *  default, so a typo can't quietly widen the window. */
export function parseWindowDays(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEMAND_DEFAULT_WINDOW_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequestException('window must be a positive integer number of days');
  }
  return Math.min(Math.max(n, DEMAND_MIN_WINDOW_DAYS), DEMAND_MAX_WINDOW_DAYS);
}

@Controller('me/market')
export class MarketDemandController {
  constructor(
    private readonly demand: MarketDemandService,
    private readonly session: SessionService,
  ) {}

  @Get('skill-demand')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async skillDemand(@Req() req: Request, @Query('window') windowQ?: string) {
    const userId = this.session.requireUserId(req);
    return this.demand.skillDemand(userId, parseWindowDays(windowQ));
  }

  @Get('trends')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async trends(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.demand.trendSignals(userId);
  }
}
