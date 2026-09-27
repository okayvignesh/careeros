import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProviderConfigSchema, type ProviderConfigInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { ProvidersService } from './providers.service';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.providers.listProviders(userId);
  }

  @Post()
  @HttpCode(201)
  async save(
    @Body(new ZodValidationPipe(ProviderConfigSchema)) body: ProviderConfigInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.providers.saveProvider(userId, body);
  }

  @Post(':id/default')
  @HttpCode(200)
  async setDefault(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.providers.setDefault(userId, id);
    return { ok: true };
  }

  @Post('probe')
  @HttpCode(200)
  async probe(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.providers.probe(userId);
  }
}
