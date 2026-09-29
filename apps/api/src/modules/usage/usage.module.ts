import { Global, Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageAdvancedController } from './usage-advanced.controller';
import { UsageAdvancedService } from './usage-advanced.service';
import { UsageService } from './usage.service';
import { UsageCache } from './usage.cache';
import { RequireAdminGuard } from '../../common/guards/require-admin.guard';

@Global()
@Module({
  controllers: [UsageController, UsageAdvancedController],
  providers: [UsageService, UsageCache, UsageAdvancedService, RequireAdminGuard],
  exports: [UsageService, UsageCache, UsageAdvancedService],
})
export class UsageModule {}
