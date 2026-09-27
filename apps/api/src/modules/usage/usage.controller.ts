import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { UsageService, type Window } from './usage.service';
import { SensitivityGateService, type ProviderCeiling } from '../../common/sensitivity-gate.service';

const WINDOWS = new Set<Window>(['7d', '30d', '90d', 'mtd']);
const BREAKDOWN_KEYS = new Set(['provider', 'model', 'callKind']);

function parseWindow(w: string | undefined): Window {
  const v = (w ?? '30d') as Window;
  if (!WINDOWS.has(v)) throw new BadRequestException(`Invalid window: ${w}`);
  return v;
}

const CEILINGS: ProviderCeiling[] = [
  'block',
  'local-only',
  'public',
  'personal',
  'confidential',
  'employer-confidential',
];

@Controller('me/usage')
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly session: SessionService,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  @Get('summary')
  async summary(@Query('window') w: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.usage.summary(userId, parseWindow(w));
  }

  @Get('breakdown')
  async breakdown(
    @Query('by') by: string | undefined,
    @Query('window') w: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const key = (by ?? 'model') as 'provider' | 'model' | 'callKind';
    if (!BREAKDOWN_KEYS.has(key)) throw new BadRequestException(`Invalid by: ${by}`);
    return this.usage.breakdown(userId, key, parseWindow(w));
  }

  @Get('timeseries')
  async timeseries(
    @Query('window') w: string | undefined,
    @Query('bucket') b: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const bucket = (b ?? 'day') as 'hour' | 'day';
    if (bucket !== 'hour' && bucket !== 'day') throw new BadRequestException(`Invalid bucket: ${b}`);
    return this.usage.timeseries(userId, parseWindow(w), bucket);
  }

  @Get('calls')
  async calls(
    @Query('limit') limit: string | undefined,
    @Query('errorsOnly') errorsOnly: string | undefined,
    @Query('provider') provider: string | undefined,
    @Query('model') model: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const parsed = Number(limit ?? 100);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('limit must be a positive number.');
    }
    const filter: { errorsOnly?: boolean; provider?: string; model?: string } = {
      errorsOnly: errorsOnly === '1' || errorsOnly === 'true',
    };
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    return this.usage.calls(userId, parsed, filter);
  }

  @Get('budget')
  async budget(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.usage.getBudget(userId);
  }

  @Post('budget')
  @HttpCode(200)
  async setBudget(@Body() body: { monthlyLimitUsd: number | null }, @Req() req: Request) {
    this.session.requireUserId(req);
    if (body.monthlyLimitUsd !== null && (typeof body.monthlyLimitUsd !== 'number' || body.monthlyLimitUsd < 0)) {
      throw new BadRequestException('monthlyLimitUsd must be a non-negative number or null.');
    }
    await this.usage.setMonthlyLimit(body.monthlyLimitUsd);
    return { ok: true };
  }

  @Get('pause')
  async pause(@Req() req: Request) {
    this.session.requireUserId(req);
    return { paused: await this.usage.isPaused() };
  }

  @Post('pause')
  @HttpCode(200)
  async setPause(@Body() body: { paused: boolean }, @Req() req: Request) {
    this.session.requireUserId(req);
    if (typeof body.paused !== 'boolean') throw new BadRequestException('paused must be boolean.');
    await this.usage.setPaused(body.paused);
    return { paused: body.paused };
  }

  @Get('sensitivity')
  async sensitivityPolicy(@Req() req: Request) {
    this.session.requireUserId(req);
    return { policy: await this.sensitivity.getPolicy(), levels: CEILINGS };
  }

  @Post('sensitivity')
  @HttpCode(200)
  async setSensitivity(
    @Body() body: { providerName: string; ceiling: ProviderCeiling },
    @Req() req: Request,
  ) {
    this.session.requireUserId(req);
    if (typeof body.providerName !== 'string' || !body.providerName) {
      throw new BadRequestException('providerName is required.');
    }
    if (!CEILINGS.includes(body.ceiling)) {
      throw new BadRequestException(`ceiling must be one of ${CEILINGS.join(', ')}.`);
    }
    await this.sensitivity.setProviderCeiling(body.providerName, body.ceiling);
    return { ok: true };
  }
}
