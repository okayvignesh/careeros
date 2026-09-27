import { Global, Module } from '@nestjs/common';
import { SensitivityGateService } from './sensitivity-gate.service';

@Global()
@Module({
  providers: [SensitivityGateService],
  exports: [SensitivityGateService],
})
export class SensitivityGateModule {}
