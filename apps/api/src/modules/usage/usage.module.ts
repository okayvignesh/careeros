import { Global, Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsageCache } from './usage.cache';
import { RequireAdminGuard } from '../../common/guards/require-admin.guard';

@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService, UsageCache, RequireAdminGuard],
  exports: [UsageService, UsageCache],
})
export class UsageModule {}
