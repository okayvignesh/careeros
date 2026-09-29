import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { DailyBriefComposerService } from './daily-brief-composer.service';
import {
  DailyBriefPreferencesService,
  type UpsertPreferencesInput,
} from './daily-brief-preferences.service';
import { DailyBriefScheduler } from './daily-brief.scheduler';

/**
 * E.3 endpoints.
 *
 *   GET  /brief/preferences        - fetch (null if never set)
 *   POST /brief/preferences        - upsert (tz + hour + channels)
 *   POST /brief/enable             - flip is_enabled
 *   POST /brief/snooze             - body { days: 0..30 }; 0 clears
 *   POST /brief/preview            - compose on-demand, do not persist
 *   GET  /brief/latest             - return last composed payload (from
 *                                    audit_log). Useful for testing +
 *                                    for the web UI once it ships.
 *
 * The `/brief --snooze N` slash command will eventually call
 * POST /brief/snooze from the slack module; that wire is blocked by the
 * dirty slack module owned by the parallel session.
 */
@Controller('brief')
export class DailyBriefController {
  constructor(
    private readonly prefs: DailyBriefPreferencesService,
    private readonly composer: DailyBriefComposerService,
    private readonly scheduler: DailyBriefScheduler,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('preferences')
  async getPrefs(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.prefs.get(userId);
  }

  @Post('preferences')
  @HttpCode(200)
  async upsertPrefs(@Req() req: Request, @Body() body: UpsertPreferencesInput) {
    const userId = this.session.requireUserId(req);
    const result = await this.prefs.upsert(userId, body ?? {});
    await this.scheduler.reschedule(userId, result.timezone, result.sendHourLocal);
    return result;
  }

  @Post('enable')
  @HttpCode(200)
  async enable(@Req() req: Request, @Body() body: { enabled?: boolean }) {
    const userId = this.session.requireUserId(req);
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be boolean');
    }
    const p = await this.prefs.setEnabled(userId, body.enabled);
    if (body.enabled) {
      await this.scheduler.reschedule(userId, p.timezone, p.sendHourLocal);
    } else {
      await this.scheduler.unschedule(userId);
    }
    return p;
  }

  @Post('snooze')
  @HttpCode(200)
  async snooze(@Req() req: Request, @Body() body: { days?: number }) {
    const userId = this.session.requireUserId(req);
    if (typeof body?.days !== 'number') {
      throw new BadRequestException('days must be number 0-30');
    }
    const p = await this.prefs.snooze(userId, body.days);
    // Reschedule so the delay reflects the new snoozedUntil - the
    // scheduler's runJob path handles this too, but doing it here means
    // the pending job in the queue reflects the truth immediately.
    await this.scheduler.reschedule(userId, p.timezone, p.sendHourLocal);
    return p;
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.composer.compose(userId);
  }

  @Get('latest')
  async latest(@Req() req: Request, @Query('limit') limitRaw: string | undefined) {
    const userId = this.session.requireUserId(req);
    const limit = clamp(Number(limitRaw ?? '1'), 1, 30);
    const rows = await this.prisma.auditEvent.findMany({
      where: { userId, action: 'daily_brief.composed' },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { id: true, timestamp: true, payload: true },
    });
    return rows.map((r) => ({
      id: r.id,
      composedAt: r.timestamp.toISOString(),
      payload: r.payload,
    }));
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
