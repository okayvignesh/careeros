import { Module } from '@nestjs/common';
import { SensitivityGate } from '@careeros/ai';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService, APPROVAL_SENSITIVITY_GATE } from './approvals.service';

/**
 * F.1: approval-queue module.
 *
 * A single process-wide SensitivityGate instance backs the fresh-re-auth
 * window used by approve() + bulkApprove(). The gate is a plain class from
 * `@careeros/ai` (C-P0.3) that holds a per-(userId, opTag) map of last
 * re-auth timestamps. Callers that mint a fresh re-auth (passkey verify,
 * password re-verify) resolve the same instance via `APPROVAL_SENSITIVITY_GATE`
 * and call `.withReauthWindow(...)` immediately after success.
 *
 * ponytail: one instance per process. Multi-node deploys swap this for a
 * redis-backed adapter; single-user MVP shape means one node.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    { provide: APPROVAL_SENSITIVITY_GATE, useValue: new SensitivityGate() },
  ],
  exports: [ApprovalsService, APPROVAL_SENSITIVITY_GATE],
})
export class ApprovalsModule {}
