import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

/**
 * F.1: approval-queue module.
 *
 * Fresh re-auth windows are owned by the global SensitivityGateService (A6):
 * callers that mint a fresh re-auth (passkey verify, password re-verify) call
 * `SensitivityGateService.withReauthWindow(...)` on the same singleton that
 * approve() reads via `hasFreshReauth`, so there is one gate, not two.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
