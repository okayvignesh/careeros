import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchProvidersController } from './search-providers.controller';
import { SearchProvidersService } from './search-providers.service';

@Module({
  imports: [AuthModule],
  controllers: [SearchProvidersController],
  providers: [SearchProvidersService],
})
export class SearchProvidersModule {}
