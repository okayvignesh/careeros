import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { LearningPriorityController } from './learning-priority.controller';
import { LearningPriorityService } from './learning-priority.service';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';
import { MarketDemandModule } from '../market-demand/market-demand.module';

@Module({
  imports: [JobPreferencesModule, MarketDemandModule],
  controllers: [SkillsController, LearningPriorityController],
  providers: [SkillsService, LearningPriorityService],
  exports: [LearningPriorityService],
})
export class SkillsModule {}
