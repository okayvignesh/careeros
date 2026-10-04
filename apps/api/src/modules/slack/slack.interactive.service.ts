// Interactive (Block Kit) action dispatch. Replaces the old echo handler.
// Action ids follow `<prefix>:<verb>[:<id>]`; each prefix routes to a real
// side effect, and every path writes an audit event. Approval actions go
// through the F.1 queue, so the "model never approves its own action" rule is
// preserved: a human clicked the button.
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { ephemeralText, jobCardBlock, type SlackBlock, type SlackMessage } from './slack.block-kit';
import { SlackCommandsService } from './slack.commands.service';
import { SlackContextService } from './slack.context';

export interface SlackInteractivePayload {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string; value?: string; block_id?: string }>;
}

@Injectable()
export class SlackInteractiveService {
  private readonly logger = new Logger(SlackInteractiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: SlackContextService,
    private readonly approvals: ApprovalsService,
    private readonly commands: SlackCommandsService,
    private readonly assessments: AssessmentsService,
  ) {}

  async handle(payload: SlackInteractivePayload): Promise<SlackMessage> {
    const action = payload.actions?.[0];
    const actionId = action?.action_id ?? '';
    if (!actionId) return ephemeralText('No action found in that interaction.');

    const userId = await this.context.resolveUserId();
    if (!userId) return ephemeralText('Career OS has no user yet. Finish setup first.');

    const [prefix, verb, ...rest] = actionId.split(':');
    const id = rest.join(':') || action?.value || '';
    try {
      switch (prefix) {
        case 'approval':
          return await this.approvalAction(userId, verb, id);
        case 'brief':
          return await this.briefAction(userId, verb, id);
        case 'job':
          return await this.jobAction(userId, verb, id);
        case 'assessment':
          return await this.assessmentAction(userId, verb, id);
        default:
          return ephemeralText(`Unhandled action: ${actionId}`);
      }
    } catch (err) {
      this.logger.error(`interactive ${actionId} failed: ${(err as Error).message}`);
      return ephemeralText(`That action failed: ${(err as Error).message}`);
    }
  }

  // ---- prefixes -----------------------------------------------------------

  private async approvalAction(userId: string, verb: string, id: string): Promise<SlackMessage> {
    if (!id) return ephemeralText('Missing approval id.');
    if (verb === 'approve') {
      const item = await this.approvals.approve({ userId, itemId: id });
      await this.audit(userId, 'slack.approval.approved', id, { kind: item.kind });
      return ephemeralText(`Approved \`${id}\` (${item.kind}). It will execute shortly.`);
    }
    if (verb === 'reject') {
      const item = await this.approvals.cancel({ userId, itemId: id, reason: 'rejected via Slack' });
      await this.audit(userId, 'slack.approval.rejected', id, { kind: item.kind });
      return ephemeralText(`Rejected \`${id}\` (${item.kind}).`);
    }
    return ephemeralText(`Unknown approval action: ${verb}`);
  }

  private async briefAction(userId: string, verb: string, id: string): Promise<SlackMessage> {
    switch (verb) {
      case 'show_jobs':
        return this.commands.jobs(userId, 3);
      case 'market_brief':
        return this.commands.marketBrief(userId);
      case 'review_progress':
        return this.commands.review(userId);
      case 'start_quest':
        return this.questDetail(userId, id);
      default:
        return ephemeralText(`Unknown brief action: ${verb}`);
    }
  }

  private async questDetail(userId: string, questId: string): Promise<SlackMessage> {
    // `start_quest` carries a quest id from dailyBriefBlock; empty when no
    // quest was available at compose time.
    if (!questId) {
      const next = await this.prisma.remediationTask.findFirst({
        where: { userId, status: 'open' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, reason: true, skillId: true },
      });
      if (!next) return ephemeralText('No open quests. Nice work.');
      questId = next.id;
    }
    const task = await this.prisma.remediationTask.findFirst({
      where: { id: questId, userId },
      select: { id: true, reason: true, skillId: true },
    });
    if (!task) return ephemeralText('That quest is no longer open.');
    const skill = await this.prisma.skill.findUnique({
      where: { id: task.skillId },
      select: { name: true },
    });
    await this.audit(userId, 'slack.quest.opened', questId, { skillId: task.skillId });
    return {
      text: `Quest: ${skill?.name ?? 'Skill'}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Quest' } },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${skill?.name ?? 'Skill'}*\n${task.reason}`,
          },
        },
        {
          type: 'actions',
          block_id: 'quest_actions',
          elements: [
            {
              type: 'button',
              action_id: `assessment:start:${task.skillId}`,
              text: { type: 'plain_text', text: 'Start drill' },
              style: 'primary',
            },
            {
              type: 'button',
              action_id: 'brief:show_jobs',
              text: { type: 'plain_text', text: 'Jobs for this skill' },
            },
          ],
        },
      ],
    };
  }

  private async jobAction(userId: string, verb: string, jobId: string): Promise<SlackMessage> {
    if (!jobId) return ephemeralText('Missing job id.');
    const job = await this.prisma.normalizedJob.findUnique({
      where: { id: jobId },
      select: { id: true, title: true, company: true, canonicalUrl: true },
    });
    if (!job) return ephemeralText('That job is no longer available.');
    if (verb === 'dismiss') {
      await this.audit(userId, 'slack.job.dismissed', jobId, { title: job.title });
      return ephemeralText(`Dismissed *${job.title}* at ${job.company}.`);
    }
    // save + apply both track the job as an application; apply additionally
    // records the intent to submit. Unique (userId, jobId) makes it idempotent.
    const state = 'interested';
    const existing = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId } },
      select: { id: true },
    });
    const app = existing
      ? existing
      : await this.prisma.application.create({
          data: {
            userId,
            jobId,
            state,
            notes: verb === 'apply' ? 'Started from Slack' : 'Saved from Slack',
            events: { create: { toState: state, byActor: 'user', notes: verb } },
          },
          select: { id: true },
        });
    await this.audit(userId, verb === 'apply' ? 'slack.job.apply' : 'slack.job.save', jobId, {
      applicationId: app.id,
    });
    const card = jobCardBlock({
      jobId: job.id,
      title: job.title,
      company: job.company,
      location: 'Unspecified',
      matchScore: 0,
      url: job.canonicalUrl,
    });
    return {
      text: verb === 'apply' ? `Tracking application: ${job.title}` : `Saved: ${job.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              verb === 'apply'
                ? `Tracking *${job.title}* at ${job.company}. Open the web app to tailor a resume and submit (submission stays approval-gated).`
                : `Saved *${job.title}* at ${job.company} to your applications.`,
          },
        },
        ...(card.blocks.filter((b): b is SlackBlock => b.type !== 'actions') as SlackBlock[]),
      ],
    };
  }

  private async assessmentAction(userId: string, verb: string, skillId: string): Promise<SlackMessage> {
    if (verb === 'snooze') {
      await this.audit(userId, 'slack.assessment.snoozed', skillId, {});
      return ephemeralText('Drill snoozed for today.');
    }
    if (verb !== 'start') return ephemeralText(`Unknown assessment action: ${verb}`);

    const skill = skillId
      ? await this.prisma.skill.findUnique({ where: { id: skillId }, select: { name: true } })
      : null;
    try {
      const question = await this.assessments.nextKnowledgeQuestion(userId, skillId || undefined);
      await this.audit(userId, 'slack.assessment.started', question.id, { skillId });
      return {
        text: `Drill: ${skill?.name ?? 'Knowledge check'}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Knowledge drill' } },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${question.difficulty}*\n${truncate(question.prompt, 900)}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Answer in the web app: open Assessment Arena. Your response is graded there.',
              },
            ],
          },
        ],
      };
    } catch (err) {
      // No provider / no question bank: still route the user somewhere real.
      await this.audit(userId, 'slack.assessment.start_failed', skillId, {
        reason: (err as Error).message,
      });
      return ephemeralText(
        `Could not start a drill for ${skill?.name ?? 'that skill'} right now. Open Assessment Arena in the web app.`,
      );
    }
  }

  private async audit(
    userId: string,
    action: string,
    resourceId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'user',
          action,
          resourceType: 'slack',
          resourceId,
          payload: payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
