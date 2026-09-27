import { Module } from '@nestjs/common';
import { JobPreferencesController } from './job-prefs.controller';
import { JobPreferencesService } from './job-prefs.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [JobPreferencesController],
  providers: [JobPreferencesService],
  exports: [JobPreferencesService],
})
export class JobPreferencesModule {}
