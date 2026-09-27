// C-P3.4: user-facing endpoints for weekly market snapshots.
//
//   POST /me/market/snapshot          - manual snapshot for the caller's prefs (rate-limited)
//   GET  /me/market/snapshot/latest   - latest snapshot for the caller
//   GET  /me/market/snapshot/trend    - week-over-week diff for the caller
//   GET  /me/market/snapshot/history  - past N snapshots (headers only, weeks<=52)
//
// All four require an authenticated session (SessionService.requireUserId
// throws UnauthorizedException on a missing/expired cookie).
import { Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SessionService } from '../auth/session.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import { SnapshotService, prefsToFilter } from './snapshot.service';

@Controller('me/market/snapshot')
export class SnapshotController {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly prefs: JobPreferencesService,
    private readonly session: SessionService,
  ) {}

  /** Manual "snapshot my current pool now". Rate-limited: 3/min per IP so
   *  the LLM-free-but-DB-heavy path can't be spammed. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async manual(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const prefs = await this.prefs.get(userId);
    return this.snapshots.writeSnapshot(userId, prefsToFilter(prefs), 'manual');
  }

  @Get('latest')
  async latest(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return (await this.snapshots.latestForUser(userId)) ?? { empty: true };
  }

  @Get('trend')
  async trend(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.snapshots.diffAgainstLastWeek(userId);
  }

  @Get('history')
  async history(@Req() req: Request, @Query('weeks') weeksQ?: string) {
    const userId = this.session.requireUserId(req);
    const weeks = weeksQ ? Number.parseInt(weeksQ, 10) : 12;
    const safe = Number.isFinite(weeks) ? weeks : 12;
    return { items: await this.snapshots.historyForUser(userId, safe) };
  }
}
