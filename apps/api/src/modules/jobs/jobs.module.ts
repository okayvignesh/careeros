import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { RequireAdminGuard } from '../../common/guards/require-admin.guard';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [JobsController],
  providers: [JobsService, RequireAdminGuard],
})
export class JobsModule {}
