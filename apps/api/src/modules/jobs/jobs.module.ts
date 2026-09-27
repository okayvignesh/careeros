import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { RejectLogController } from './reject-log.controller';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { RequireAdminGuard } from '../../common/guards/require-admin.guard';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [JobsController, RejectLogController],
  providers: [JobsService, RequireAdminGuard],
})
export class JobsModule {}
