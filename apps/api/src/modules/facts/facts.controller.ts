import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { FactsService } from './facts.service';

@Controller('me/facts')
export class FactsController {
  constructor(
    private readonly facts: FactsService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.facts.list(userId);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: { verified: boolean }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    if (typeof body.verified !== 'boolean') {
      throw new BadRequestException('verified must be boolean');
    }
    return this.facts.setVerified(userId, id, body.verified);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.facts.remove(userId, id);
  }
}
