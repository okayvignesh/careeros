import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import {
  UsageAdvancedService,
  type ExportFormat,
} from './usage-advanced.service';
import { type Window } from './usage.service';

/**
 * F.9 endpoints. All auth-gated per-user; no admin gate because these
 * are the user's OWN usage stats (unlike setBudget etc. which mutate
 * global AppConfig and stay admin-only on UsageController).
 *
 *   GET /me/usage/cost-projection?window=7d|30d|90d|mtd
 *   GET /me/usage/latency-histogram?window=7d[&promptId=X]
 *   GET /me/usage/security-stats?window=30d
 *   GET /me/usage/anomaly?window=7d
 *   GET /me/usage/export?window=30d&format=csv|json (downloads file)
 */

const WINDOWS = new Set<Window>(['7d', '30d', '90d', 'mtd']);
const FORMATS = new Set<ExportFormat>(['csv', 'json']);

function parseWindow(w: string | undefined, fallback: Window = '30d'): Window {
  const v = (w ?? fallback) as Window;
  if (!WINDOWS.has(v)) throw new BadRequestException(`Invalid window: ${w}`);
  return v;
}

function parseFormat(f: string | undefined): ExportFormat {
  const v = (f ?? 'csv') as ExportFormat;
  if (!FORMATS.has(v)) throw new BadRequestException(`Invalid format: ${f}`);
  return v;
}

@Controller('me/usage')
export class UsageAdvancedController {
  constructor(
    private readonly advanced: UsageAdvancedService,
    private readonly session: SessionService,
  ) {}

  @Get('cost-projection')
  async costProjection(@Query('window') w: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.advanced.costProjection(userId, parseWindow(w, '7d'));
  }

  @Get('latency-histogram')
  async latencyHistogram(
    @Query('window') w: string | undefined,
    @Query('promptId') promptId: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.advanced.latencyHistogram(userId, parseWindow(w, '7d'), promptId);
  }

  @Get('security-stats')
  async securityStats(@Query('window') w: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.advanced.securityStats(userId, parseWindow(w, '30d'));
  }

  @Get('anomaly')
  async anomaly(@Query('window') w: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.advanced.detectAnomaly(userId, parseWindow(w, '7d'));
  }

  @Get('export')
  async exportCalls(
    @Query('window') w: string | undefined,
    @Query('format') f: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.session.requireUserId(req);
    const out = await this.advanced.exportCalls(
      userId,
      parseWindow(w, '30d'),
      parseFormat(f),
    );
    res.status(200);
    res.setHeader('content-type', out.contentType);
    res.setHeader('content-disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }
}
