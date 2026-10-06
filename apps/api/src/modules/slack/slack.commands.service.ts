// Real slash-command handlers (Phase 5 §Runtime). Replaces the placeholder
// router defaults: every command now reads real data through Prisma /
// ApprovalsService and returns a Block Kit response. The pure routing table
// stays in slack.slash-commands.ts; this service supplies the overrides.
//
// Responses are ephemeral by default (Slack's contract for slash commands):
// the controller returns the message inline, no chat.postMessage needed. The
// only outbound write is `/pause` + `/resume`, which toggle the user's
// daily-brief preference, and every command writes an audit event.
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  approvalPromptBlock,
  assessmentPromptBlock,
  dailyBriefBlock,
  ephemeralText,
  jobCardBlock,
  type SlackBlock,
  type SlackMessage,
} from './slack.block-kit';
import {
  buildSlashRouter,
  type SlackSlashPayload,
  type SlashCommand,
  type SlashHandler,
} from './slack.slash-commands';
import { SlackContextService } from './slack.context';

const MAX_JOB_CARDS = 5;

@Injectable()
export class SlackCommandsService {
  private readonly logger = new Logger(SlackCommandsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: SlackContextService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Override table consumed by the controller's `dispatchSlash`. */
  router(): Record<SlashCommand, SlashHandler> {
    return buildSlashRouter({
      '/jobs': (p) => this.withUser(p, (userId) => this.jobs(userId, parseCount(p.text))),
      '/brief': (p) => this.withUser(p, (userId) => this.brief(userId)),
      '/review': (p) => this.withUser(p, (userId) => this.review(userId)),
      '/approve': (p) => this.withUser(p, (userId) => this.approve(userId, p.text.trim())),
      '/quiz': (p) => this.withUser(p, (userId) => this.quiz(userId, p.text.trim())),
      '/pause': (p) => this.withUser(p, (userId) => this.setEnabled(userId, false)),
      '/resume': (p) => this.withUser(p, (userId) => this.setEnabled(userId, true)),
    });
  }

  // ---- individual commands ------------------------------------------------

  async jobs(userId: string, n = 3): Promise<SlackMessage> {
    const jobs = await this.prisma.normalizedJob.findMany({
      where: { state: { in: ['verified', 'discovered'] } },
      orderBy: [{ sourcePostedAt: 'desc' }, { firstSeenAt: 'desc' }],
      take: Math.min(Math.max(n, 1), MAX_JOB_CARDS),
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        canonicalUrl: true,
      },
    });
    await this.audit(userId, 'slack.command.jobs', { count: jobs.length });
    if (jobs.length === 0) {
      return ephemeralText('No jobs available yet. Run a job sync in the web app first.');
    }
    const cards = jobs.map((j) =>
      jobCardBlock({
        jobId: j.id,
        title: j.title,
        company: j.company,
        location: j.location ?? 'Unspecified',
        matchScore: 0,
        url: j.canonicalUrl,
      }),
    );
    return combine(
      `Top ${jobs.length} job matches`,
      cards.flatMap((c) => c.blocks),
    );
  }

  async brief(userId: string): Promise<SlackMessage> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [xpAll, xpDelta, streak, tasks, newJobs, snapshot] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.prisma.xpEvent.aggregate({
        where: { userId, createdAt: { gte: dayAgo } },
        _sum: { xp: true },
      }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.prisma.remediationTask.findMany({
        where: { userId, status: 'open' },
        orderBy: { createdAt: 'asc' },
        take: 3,
        select: { id: true, reason: true, skillId: true },
      }),
      this.prisma.normalizedJob.count({ where: { firstSeenAt: { gte: dayAgo } } }),
      this.prisma.marketSnapshot.findFirst({
        where: { userId },
        orderBy: { snapshotAt: 'desc' },
        select: { statsJson: true },
      }),
    ]);
    const skills =
      tasks.length > 0
        ? await this.prisma.skill.findMany({
            where: { id: { in: tasks.map((t) => t.skillId) } },
            select: { id: true, name: true },
          })
        : [];
    const skillName = new Map(skills.map((s) => [s.id, s.name]));

    const msg = dailyBriefBlock({
      levelLabel: `${xpAll._sum.xp ?? 0} XP (+${xpDelta._sum.xp ?? 0} today)`,
      quests: tasks.map((t) => ({
        id: t.id,
        title: `${skillName.get(t.skillId) ?? 'Skill'}: ${t.reason}`,
      })),
      newJobs,
      marketPulse: topRiser(snapshot?.statsJson ?? null) ?? 'No signal yet',
      streakDays: streak?.currentDays ?? 0,
    });
    await this.audit(userId, 'slack.command.brief', { newJobs, quests: tasks.length });
    return msg;
  }

  async review(userId: string): Promise<SlackMessage> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [xpDelta, attempts, applications, openQuestCount] = await Promise.all([
      this.prisma.xpEvent.aggregate({
        where: { userId, createdAt: { gte: dayAgo } },
        _sum: { xp: true },
      }),
      this.prisma.attempt.count({ where: { userId, createdAt: { gte: dayAgo } } }),
      this.prisma.application.count({ where: { userId, createdAt: { gte: dayAgo } } }),
      this.prisma.remediationTask.count({ where: { userId, status: 'open' } }),
    ]);
    await this.audit(userId, 'slack.command.review', { attempts, applications });
    return {
      text: 'Yesterday in review',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Yesterday in review' } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*XP earned*\n${xpDelta._sum.xp ?? 0}` },
            { type: 'mrkdwn', text: `*Attempts*\n${attempts}` },
            { type: 'mrkdwn', text: `*Applications added*\n${applications}` },
            { type: 'mrkdwn', text: `*Open quests*\n${openQuestCount}` },
          ],
        },
        {
          type: 'actions',
          block_id: 'brief_actions',
          elements: [
            {
              type: 'button',
              action_id: 'brief:review_progress',
              text: { type: 'plain_text', text: 'Refresh' },
            },
            {
              type: 'button',
              action_id: 'brief:show_jobs',
              text: { type: 'plain_text', text: 'Show jobs' },
            },
          ],
        },
      ],
    };
  }

  async approve(userId: string, id: string): Promise<SlackMessage> {
    if (!id) return ephemeralText('Usage: `/approve <approval_id>`');
    const item = await this.prisma.approvalItem.findFirst({
      where: { id, userId },
      select: { id: true, kind: true, state: true, diffJson: true },
    });
    if (!item) return ephemeralText(`No approval item \`${id}\` for this account.`);
    if (item.state !== 'pending') {
      return ephemeralText(`Approval \`${id}\` is already *${item.state}*.`);
    }
    const summary = summarizeDiff(item.diffJson);
    await this.audit(userId, 'slack.command.approve_prompt', { approvalItemId: id, kind: item.kind });
    return approvalPromptBlock({ approvalId: item.id, action: `Approve ${item.kind}`, summary });
  }

  async quiz(userId: string, topic: string): Promise<SlackMessage> {
    if (!topic) return ephemeralText('Usage: `/quiz <topic>`');
    const skill = await this.prisma.skill.findFirst({
      where: { name: { contains: topic, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    if (!skill) {
      return ephemeralText(`No skill matches "${topic}". Try a skill from your graph.`);
    }
    await this.audit(userId, 'slack.command.quiz', { skillId: skill.id, topic });
    return assessmentPromptBlock({
      attemptId: skill.id,
      topic: skill.name,
      timeLimitMinutes: 15,
    });
  }

  async setEnabled(userId: string, enabled: boolean): Promise<SlackMessage> {
    await this.prisma.dailyBriefPreference.upsert({
      where: { userId },
      create: { userId, isEnabled: enabled },
      update: { isEnabled: enabled },
    });
    await this.audit(userId, enabled ? 'slack.command.resume' : 'slack.command.pause', {});
    return ephemeralText(
      enabled
        ? 'Daily briefs resumed. Use `/pause` to stop them again.'
        : 'Daily briefs paused. Use `/resume` to turn them back on.',
    );
  }

  /** Shared by `/brief` action rows and `brief:market_brief`. */
  async marketBrief(userId: string): Promise<SlackMessage> {
    const snapshot = await this.prisma.marketSnapshot.findFirst({
      where: { userId },
      orderBy: { snapshotAt: 'desc' },
      select: { snapshotAt: true, statsJson: true },
    });
    if (!snapshot) return ephemeralText('No market snapshot yet.');
    const riser = topRiser(snapshot.statsJson);
    await this.audit(userId, 'slack.command.market_brief', { at: snapshot.snapshotAt.toISOString() });
    return {
      text: 'Market pulse',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Market pulse' } },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: riser ? `Rising skill: *${riser}*` : 'No rising skill in the latest snapshot.',
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `snapshot ${snapshot.snapshotAt.toISOString()}` },
          ],
        },
      ],
    };
  }

  // ---- helpers ------------------------------------------------------------

  private async withUser(
    p: SlackSlashPayload,
    fn: (userId: string) => Promise<SlackMessage>,
  ): Promise<SlackMessage> {
    const userId = await this.context.resolveUserId();
    if (!userId) return ephemeralText('Career OS has no user yet. Finish setup first.');
    try {
      return await fn(userId);
    } catch (err) {
      this.logger.error(`slash ${p.command} failed: ${(err as Error).message}`);
      return ephemeralText(`That command failed: ${(err as Error).message}`);
    }
  }

  private async audit(userId: string, action: string, payload: Record<string, unknown>) {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'user',
          action,
          resourceType: 'slack',
          resourceId: null,
          payload: payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
}

function parseCount(text: string): number {
  const n = Number.parseInt(text.trim(), 10);
  return Number.isFinite(n) ? n : 3;
}

function combine(text: string, blocks: SlackBlock[]): SlackMessage {
  return { text, blocks };
}

function topRiser(statsJson: unknown): string | null {
  if (!statsJson || typeof statsJson !== 'object') return null;
  const top = (statsJson as Record<string, unknown>).topSkills;
  if (!Array.isArray(top) || top.length === 0) return null;
  const name = (top[0] as Record<string, unknown>)?.skillName;
  return typeof name === 'string' ? name : null;
}

function summarizeDiff(diff: unknown): string {
  if (!diff || typeof diff !== 'object') return 'Review in the approval queue.';
  const d = diff as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof d.to === 'string') bits.push(`To: ${d.to}`);
  if (typeof d.subject === 'string') bits.push(`Subject: ${d.subject}`);
  if (typeof d.body === 'string') bits.push(String(d.body).slice(0, 200));
  return bits.join('\n') || 'Review in the approval queue.';
}
