import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * E.7 (Wave E / P5): inbox triage + email-application fuzzy links.
 *
 * Exports InboxService for consumers (email-ingest worker) to call
 * `ingest()` per classified email. HTTP surface for list / link /
 * unlink / dismiss lives on the controller.
 */
@Module({
  imports: [AuthModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
