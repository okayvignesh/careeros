import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
