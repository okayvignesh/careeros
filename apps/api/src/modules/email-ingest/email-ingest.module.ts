import { Module } from '@nestjs/common';
import { EmailIngestService } from './email-ingest.service';

// E.6e: consumer for the `email-processing` queue produced by GmailService.
// No controller — this module is worker-only.
@Module({
  providers: [EmailIngestService],
  exports: [EmailIngestService],
})
export class EmailIngestModule {}
