import { Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChannelRegistry, SlackChannel, WebChannel } from '@careeros/messaging';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../prisma/prisma.service';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { DailyBriefComposerService } from './daily-brief-composer.service';
import { DailyBriefPreferencesService } from './daily-brief-preferences.service';
import { DailyBriefController } from './daily-brief.controller';
import { DailyBriefScheduler } from './daily-brief.scheduler';
import {
  CHANNEL_REGISTRY,
  DailyBriefDeliveryService,
} from './daily-brief-delivery.service';

/**
 * E.3b (Wave E / P5). Ships:
 *   - preferences service + composer + BullMQ scheduler/worker
 *   - ChannelRegistry delivery: WebChannel (in-app mirror) + SlackChannel
 *     (SlackService.postMessage), routed by the user's `channels` pref
 *   - HTTP endpoints for GET/POST prefs, enable, snooze, preview, latest
 *
 * WhatsApp/Discord stubs stay unregistered by design (phase-5 delivery
 * abstraction).
 */
@Module({
  imports: [AuthModule, SlackModule],
  controllers: [DailyBriefController],
  providers: [
    DailyBriefPreferencesService,
    DailyBriefComposerService,
    DailyBriefScheduler,
    DailyBriefDeliveryService,
    {
      provide: CHANNEL_REGISTRY,
      inject: [PrismaService, SlackService],
      useFactory: (prisma: PrismaService, slack: SlackService): ChannelRegistry => {
        const registry = new ChannelRegistry();
        registry.register(
          new WebChannel(async (userId, payload) => {
            const row = await prisma.auditEvent.create({
              data: {
                userId,
                actor: 'system',
                action: 'daily_brief.delivered',
                resourceType: 'daily_brief',
                resourceId: null,
                payload: {
                  channel: 'web',
                  text: payload.plaintext_fallback,
                  blocks: payload.blocks ?? [],
                } as unknown as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
            return row.id;
          }),
        );
        registry.register(new SlackChannel((args) => slack.postMessage(args)));
        return registry;
      },
    },
  ],
  exports: [DailyBriefPreferencesService, DailyBriefComposerService, DailyBriefScheduler],
})
export class DailyBriefModule {}
