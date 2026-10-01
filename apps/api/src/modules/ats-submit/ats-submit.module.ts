import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AtsSubmitController } from './ats-submit.controller';
import { AtsSubmitService } from './ats-submit.service';

/**
 * F.2 (Wave F / P6): ATS application submit (Ashby + Greenhouse).
 */
@Module({
  imports: [AuthModule],
  controllers: [AtsSubmitController],
  providers: [AtsSubmitService],
  exports: [AtsSubmitService],
})
export class AtsSubmitModule {}
