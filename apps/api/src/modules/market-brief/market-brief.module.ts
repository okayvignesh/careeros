import { Module } from '@nestjs/common';
import { MarketBriefController } from './market-brief.controller';
import { MarketBriefService } from './market-brief.service';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [MarketBriefController],
  providers: [MarketBriefService],
})
export class MarketBriefModule {}
