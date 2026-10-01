import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { AtsSubmitController } from './ats-submit.controller';
import { AtsSubmitService } from './ats-submit.service';

/**
 * F.2 (Wave F / P6): ATS application submit (Ashby + Greenhouse).
 * Imports ApprovalsModule so AtsSubmitService can register as the worker
 * for `ats_submit` approval items (F.1 wire).
 */
@Module({
  imports: [AuthModule, ApprovalsModule],
  controllers: [AtsSubmitController],
  providers: [AtsSubmitService],
  exports: [AtsSubmitService],
})
export class AtsSubmitModule {}
