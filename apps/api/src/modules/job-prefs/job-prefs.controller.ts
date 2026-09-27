import { BadRequestException, Body, Controller, Get, HttpCode, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { JobPreferencesInputSchema } from '@careeros/shared';
import { SessionService } from '../auth/session.service';
import { JobPreferencesService } from './job-prefs.service';

@Controller('me/job-preferences')
export class JobPreferencesController {
  constructor(
    private readonly prefs: JobPreferencesService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async get(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.prefs.get(userId);
  }

  @Put()
  @HttpCode(200)
  async upsert(@Body() body: unknown, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const parsed = JobPreferencesInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return this.prefs.upsert(userId, parsed.data);
  }
}
