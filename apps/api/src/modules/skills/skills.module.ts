import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { LearningPriorityController } from './learning-priority.controller';
import { LearningPriorityService } from './learning-priority.service';
import { JobPreferencesModule } from '../job-prefs/job-prefs.module';

@Module({
  imports: [JobPreferencesModule],
  controllers: [SkillsController, LearningPriorityController],
  providers: [SkillsService, LearningPriorityService],
})
export class SkillsModule {}
