import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackOAuthService } from './slack.oauth';

@Module({
  imports: [PrismaModule],
  controllers: [SlackController],
  providers: [SlackService, SlackOAuthService],
  exports: [SlackService, SlackOAuthService],
})
export class SlackModule {}
