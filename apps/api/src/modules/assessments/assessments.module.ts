import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { AuthModule } from '../auth/auth.module';

// UsageModule, UsageCache, and SensitivityGateModule are @Global(), so no
// import is needed here for those providers.

@Module({
  imports: [AuthModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
