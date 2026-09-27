import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { GoalsModule } from '../goals/goals.module';
import { RecoveryModule } from '../recovery/recovery.module';
import { HealthModule } from '../health/health.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [ProvidersModule, EmbeddingsModule, IntegrationsModule, GoalsModule, RecoveryModule, HealthModule],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
