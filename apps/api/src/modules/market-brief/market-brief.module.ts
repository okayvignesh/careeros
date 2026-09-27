import { Module } from '@nestjs/common';
import { MarketBriefController } from './market-brief.controller';
import { MarketBriefService } from './market-brief.service';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './snapshot.service';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [MarketBriefController, SnapshotController],
  providers: [MarketBriefService, SnapshotService],
  exports: [SnapshotService],
})
export class MarketBriefModule {}
