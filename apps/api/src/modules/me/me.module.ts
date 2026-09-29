import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * F.8 (Wave F / P6): data-portability endpoints.
 *   POST /me/export - user-scoped JSON dump of every user-owned table
 *   POST /me/delete - right-to-erasure (cascade + audit)
 */
@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
