import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ORDER = [
  'not_started',
  'account_created',
  'provider_configured',
  'provider_verified',
  'embedding_configured',
  'embedding_verified',
  'github_connected',
  'integrations_reviewed',
  'resume_uploaded',
  'facts_reviewed',
  'goals_set',
  'health_verified',
  'recovery_acknowledged',
  'complete',
] as const;

@Injectable()
export class SetupService {
  constructor(private readonly prisma: PrismaService) {}

  async getState(): Promise<{ state: string; hasUser: boolean }> {
    const first = await this.prisma.user.findFirst({
      select: { id: true, setupState: true },
    });
    if (!first) return { state: 'not_started', hasUser: false };
    return { state: first.setupState?.state ?? 'not_started', hasUser: true };
  }

  async isComplete(): Promise<boolean> {
    const { state } = await this.getState();
    return state === 'complete';
  }

  /** Advance to a specific state, only if it's strictly ahead of the current one. */
  async advance(userId: string, to: (typeof ORDER)[number]): Promise<void> {
    const row = await this.prisma.setupStateRow.findUnique({ where: { userId } });
    const currentIdx = ORDER.indexOf((row?.state ?? 'not_started') as (typeof ORDER)[number]);
    const nextIdx = ORDER.indexOf(to);
    if (nextIdx > currentIdx) {
      const update: { state: string; completedAt?: Date } = { state: to };
      if (to === 'complete') update.completedAt = new Date();
      await this.prisma.setupStateRow.upsert({
        where: { userId },
        create: { userId, state: to },
        update,
      });
    }
  }
}
