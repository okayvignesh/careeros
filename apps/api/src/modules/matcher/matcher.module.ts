import { Module } from '@nestjs/common';
import { MatcherController } from './matcher.controller';
import { MatcherService } from './matcher.service';

@Module({
  controllers: [MatcherController],
  providers: [MatcherService],
})
export class MatcherModule {}
