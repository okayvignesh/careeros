// Slack payloads carry Slack user/team ids, not Career OS user ids. The
// single-user default install binds one app user to the workspace at OAuth
// completion (published as `integration(kind='slack').userId`); this service
// resolves that binding. For installs predating that binding we fall back to
// `SLACK_APP_USER_EMAIL`, then to the oldest user (single-user tool).
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SlackContextService {
  private readonly logger = new Logger(SlackContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the Career OS user for any inbound Slack interaction. Returns null
   * when no user exists yet (pre-setup) so callers can answer with a friendly
   * ephemeral instead of throwing.
   */
  async resolveUserId(): Promise<string | null> {
    const integration = await this.prisma.integration.findFirst({
      where: { kind: 'slack', status: 'connected' },
      select: { userId: true },
      orderBy: { connectedAt: 'asc' },
    });
    if (integration) return integration.userId;

    const pinnedEmail = process.env.SLACK_APP_USER_EMAIL;
    if (pinnedEmail) {
      const pinned = await this.prisma.user.findUnique({
        where: { email: pinnedEmail },
        select: { id: true },
      });
      if (pinned) return pinned.id;
      this.logger.warn(`SLACK_APP_USER_EMAIL=${pinnedEmail} matched no user`);
    }

    const first = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return first?.id ?? null;
  }
}
