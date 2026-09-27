import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * C-P4.8: single global registry so every module can inject MetricsService
 * without re-declaring the provider. Controller lives here so main.ts
 * doesn't need to know about it.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
