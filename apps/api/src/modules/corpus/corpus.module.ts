import { Module } from '@nestjs/common';
import { CorpusController } from './corpus.controller';
import { CorpusService } from './corpus.service';
import { AuthModule } from '../auth/auth.module';

// UsageModule + SensitivityGateModule are @Global; no imports needed.

@Module({
  imports: [AuthModule],
  controllers: [CorpusController],
  providers: [CorpusService],
})
export class CorpusModule {}
