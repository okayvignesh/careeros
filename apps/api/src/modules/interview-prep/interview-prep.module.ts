import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InterviewPrepController } from './interview-prep.controller';
import { InterviewPrepService } from './interview-prep.service';

/** F.4 (Wave F / P6): interview prep + talk-track generation. */
@Module({
  imports: [AuthModule],
  controllers: [InterviewPrepController],
  providers: [InterviewPrepService],
  exports: [InterviewPrepService],
})
export class InterviewPrepModule {}
