import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { RecoveryService } from './recovery.service';

@Controller('recovery')
export class RecoveryController {
  constructor(
    private readonly recovery: RecoveryService,
    private readonly session: SessionService,
  ) {}

  @Post('generate')
  @HttpCode(201)
  async generate(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.recovery.generate(userId);
  }

  @Post('acknowledge')
  @HttpCode(204)
  async acknowledge(@Req() req: Request): Promise<void> {
    const userId = this.session.requireUserId(req);
    await this.recovery.acknowledge(userId);
  }
}
