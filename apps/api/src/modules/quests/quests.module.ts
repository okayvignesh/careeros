import { Module } from '@nestjs/common';
import { QuestsController } from './quests.controller';
import { QuestGeneratorService } from './quest-generator.service';
import { LearningPriorityService } from '../skills/learning-priority.service';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { MarketDemandModule } from '../market-demand/market-demand.module';

/**
 * C-P2.6c: Quest generator module. Wires the LearningPriorityService locally;
 * P2 §8 routes its demand through MarketDemandService, so that module is
 * imported too. PrismaService comes in via the global PrismaModule.
 */
@Module({
  imports: [JobPreferencesModule, MarketDemandModule],
  controllers: [QuestsController],
  providers: [QuestGeneratorService, LearningPriorityService],
  exports: [QuestGeneratorService],
})
export class QuestsModule {}
