import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { GmailAuthService } from './gmail.auth';
import { GmailOutboundService } from './gmail.outbound.service';

@Module({
  controllers: [GmailController],
  providers: [GmailAuthService, GmailOutboundService, GmailService],
  exports: [GmailService, GmailAuthService, GmailOutboundService],
})
export class GmailModule {}
