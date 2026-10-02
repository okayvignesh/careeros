import { Global, Module } from '@nestjs/common';
import { ProviderLoaderService } from './provider-loader.service';

@Global()
@Module({
  providers: [ProviderLoaderService],
  exports: [ProviderLoaderService],
})
export class ProviderLoaderModule {}
