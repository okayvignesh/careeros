import { Global, Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsageCache } from './usage.cache';

@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService, UsageCache],
  exports: [UsageService, UsageCache],
})
export class UsageModule {}
