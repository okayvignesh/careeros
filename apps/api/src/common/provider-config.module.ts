import { Global, Module } from '@nestjs/common';
import { ProviderConfigService } from './provider-config.service';

@Global()
@Module({
  providers: [ProviderConfigService],
  exports: [ProviderConfigService],
})
export class ProviderConfigModule {}
