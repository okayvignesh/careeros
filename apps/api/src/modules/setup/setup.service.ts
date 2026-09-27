import { Injectable } from '@nestjs/common';
import { SETUP_STATE_TO_SLUG, allowedSetupSlugs } from '@careeros/shared';
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

/** Shape returned by GET /setup/state. `currentStepSlug` is where the wizard
 * should send the user; `allowedSlugs` is what the web middleware whitelists
 * so URL-jumping to future steps 307s back. Both derive from `state` — they're
 * pre-computed here so the web layer doesn't need to import shared/constants.
 */
export interface SetupStateResponse {
  state: string;
  hasUser: boolean;
  currentStepSlug: string | null;
  allowedSlugs: readonly string[];
}

@Injectable()
export class SetupService {
  constructor(private readonly prisma: PrismaService) {}

  async getState(): Promise<SetupStateResponse> {
    const first = await this.prisma.user.findFirst({
      select: { id: true, setupState: true },
    });
    if (!first) {
      return {
        state: 'not_started',
        hasUser: false,
        currentStepSlug: SETUP_STATE_TO_SLUG['not_started'] ?? null,
        allowedSlugs: allowedSetupSlugs('not_started'),
      };
    }
    const state = first.setupState?.state ?? 'not_started';
    return {
      state,
      hasUser: true,
      currentStepSlug: SETUP_STATE_TO_SLUG[state] ?? null,
      allowedSlugs: allowedSetupSlugs(state),
    };
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
