// Screen 56: configured search providers + their scheduled workloads.
//
//   GET /me/search-providers            - provider inventory (config-derived)
//   GET /me/search-providers/workloads  - scheduled jobs that use a provider
//   PUT /me/search-providers/:id        - save one provider's credentials
//
// All require an authenticated session. An install with no configured source
// returns `{ providers: [] }` / `{ workloads: [] }` — a valid, documented
// empty state, never a fixture. PUT returns the refreshed provider card; secret
// fields are sealed at rest and never echoed back (only `has` booleans).
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ProviderFieldsInputSchema, type ProviderFieldsInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { SearchProvidersService } from './search-providers.service';

@Controller('me/search-providers')
export class SearchProvidersController {
  constructor(
    private readonly providers: SearchProvidersService,
    private readonly session: SessionService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.providers.list();
  }

  @Get('workloads')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async workloads(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.providers.workloads();
  }

  @Put(':id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ProviderFieldsInputSchema)) body: ProviderFieldsInput,
    @Req() req: Request,
  ) {
    this.session.requireUserId(req);
    return this.providers.save(id, body);
  }
}
