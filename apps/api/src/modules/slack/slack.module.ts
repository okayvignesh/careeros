import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackOAuthService } from './slack.oauth';
import { SlackContextService } from './slack.context';
import { SlackCommandsService } from './slack.commands.service';
import { SlackEventsService } from './slack.events.service';
import { SlackInteractiveService } from './slack.interactive.service';

@Module({
  imports: [PrismaModule, ApprovalsModule, AssessmentsModule],
  controllers: [SlackController],
  providers: [
    SlackService,
    SlackOAuthService,
    SlackContextService,
    SlackCommandsService,
    SlackEventsService,
    SlackInteractiveService,
  ],
  exports: [SlackService, SlackOAuthService],
})
export class SlackModule {}
