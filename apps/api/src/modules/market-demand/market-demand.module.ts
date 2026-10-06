import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { MarketDemandController } from './market-demand.controller';
import { MarketDemandService } from './market-demand.service';

@Module({
  imports: [AuthModule, JobPreferencesModule],
  controllers: [MarketDemandController],
  providers: [MarketDemandService],
  exports: [MarketDemandService],
})
export class MarketDemandModule {}
