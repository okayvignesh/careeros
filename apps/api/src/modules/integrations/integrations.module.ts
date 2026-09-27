import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { GithubService } from './github/github.service';

@Module({
  controllers: [IntegrationsController],
  providers: [GithubService],
  exports: [GithubService],
})
export class IntegrationsModule {}
