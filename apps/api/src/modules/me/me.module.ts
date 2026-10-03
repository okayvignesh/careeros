import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { MeController } from './me.controller';
import { MasterKeyRotationService } from './master-key-rotation.service';
import { MeService } from './me.service';

/**
 * F.8 (Wave F / P6): data-portability endpoints.
 *   POST /me/export - user-scoped JSON dump of every user-owned table
 *   POST /me/delete - right-to-erasure (cascade + audit)
 *   POST /me/security/rotate-key - master ENCRYPTION_KEY rotation (F.8 follow-up)
 *
 * F.6: GET /me/audit - read-only, user-scoped audit-log viewer.
 */
@Module({
  imports: [AuthModule],
  controllers: [MeController, AuditController],
  providers: [MeService, MasterKeyRotationService],
  exports: [MeService, MasterKeyRotationService],
})
export class MeModule {}
