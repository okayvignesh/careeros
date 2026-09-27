import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsageModule } from '../usage/usage.module';
import { DossierController } from './dossier.controller';
import { DossierService } from './dossier.service';

@Module({
  imports: [AuthModule, UsageModule],
  controllers: [DossierController],
  providers: [DossierService],
  exports: [DossierService],
})
export class DossierModule {}
