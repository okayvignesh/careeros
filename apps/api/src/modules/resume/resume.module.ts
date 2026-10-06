import { Module, forwardRef } from '@nestjs/common';
import { SetupModule } from '../setup/setup.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { ResumeController } from './resume.controller';
import { ResumeService } from './resume.service';

@Module({
  imports: [forwardRef(() => SetupModule), JobPreferencesModule],
  controllers: [ResumeController],
  providers: [ResumeService],
  exports: [ResumeService],
})
export class ResumeModule {}
