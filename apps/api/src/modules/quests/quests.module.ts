import { Module } from '@nestjs/common';
import { QuestsController } from './quests.controller';
import { QuestGeneratorService } from './quest-generator.service';
import { LearningPriorityService } from '../skills/learning-priority.service';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';

/**
 * C-P2.6c: Quest generator module. Wires the LearningPriorityService locally
 * (SkillsModule does not export it and is READ-ONLY under the C-P2.6 rules).
 * PrismaService comes in via the global PrismaModule.
 */
@Module({
  imports: [JobPreferencesModule],
  controllers: [QuestsController],
  providers: [QuestGeneratorService, LearningPriorityService],
  exports: [QuestGeneratorService],
})
export class QuestsModule {}
