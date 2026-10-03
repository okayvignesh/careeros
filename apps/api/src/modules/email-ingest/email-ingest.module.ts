import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { EmailIngestService } from './email-ingest.service';

// E.6e: consumer for the `email-processing` queue produced by GmailService.
// No controller — this module is worker-only. Imports InboxModule so
// classified recruiter/interview/assessment/rejection mail is triaged.
@Module({
  imports: [InboxModule],
  providers: [EmailIngestService],
  exports: [EmailIngestService],
})
export class EmailIngestModule {}
