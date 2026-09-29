import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyBriefComposerService } from './daily-brief-composer.service';
import { DailyBriefPreferencesService } from './daily-brief-preferences.service';
import { DailyBriefController } from './daily-brief.controller';
import { DailyBriefScheduler } from './daily-brief.scheduler';

/**
 * E.3 (Wave E / P5). Ships:
 *   - preferences service + composer + BullMQ scheduler/worker
 *   - HTTP endpoints for GET/POST prefs, enable, snooze, preview, latest
 *
 * Channel wire (SlackChannel / WebChannel) is deferred to E.3b: today
 * the scheduler writes the composed payload to audit_log so /brief/latest
 * can serve it. When the Slack module is released by the parallel
 * session, add a ChannelRegistry provider and swap the audit-write for
 * a fan-out.
 */
@Module({
  imports: [AuthModule],
  controllers: [DailyBriefController],
  providers: [
    DailyBriefPreferencesService,
    DailyBriefComposerService,
    DailyBriefScheduler,
  ],
  exports: [DailyBriefPreferencesService, DailyBriefComposerService, DailyBriefScheduler],
})
export class DailyBriefModule {}
