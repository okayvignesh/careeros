import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ApprovalsService } from '../approvals/approvals.service';
import type { AssessmentsService } from '../assessments/assessments.service';
import { SlackInteractiveService } from './slack.interactive.service';
import type { SlackCommandsService } from './slack.commands.service';
import type { SlackContextService } from './slack.context';

function fakePrisma(): PrismaService {
  return {
    approvalItem: { findFirst: vi.fn() },
    normalizedJob: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'j-1',
        title: 'Backend Engineer',
        company: 'Acme',
        canonicalUrl: 'https://jobs.test/1',
      }),
    },
    application: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
    remediationTask: {
      findFirst: vi.fn().mockResolvedValue({ id: 'q-1', reason: 'Weak on graphs', skillId: 's-1' }),
    },
    skill: { findUnique: vi.fn().mockResolvedValue({ name: 'Graphs' }) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) },
  } as unknown as PrismaService;
}

function build(
  prisma = fakePrisma(),
  approvals = {
    approve: vi.fn().mockResolvedValue({ id: 'ap-1', kind: 'outreach_email' }),
    cancel: vi.fn().mockResolvedValue({ id: 'ap-1', kind: 'outreach_email' }),
  } as unknown as ApprovalsService,
) {
  const context = { resolveUserId: vi.fn().mockResolvedValue('u-1') } as unknown as SlackContextService;
  const commands = {
    jobs: vi.fn().mockResolvedValue({ text: 'jobs', blocks: [] }),
    marketBrief: vi.fn().mockResolvedValue({ text: 'market', blocks: [] }),
    review: vi.fn().mockResolvedValue({ text: 'review', blocks: [] }),
  } as unknown as SlackCommandsService;
  const assessments = {
    nextKnowledgeQuestion: vi.fn().mockResolvedValue({
      id: 'q-1',
      prompt: 'What is a topological sort?',
      skillIds: ['s-1'],
      difficulty: 'medium',
      answerHint: null,
      sourceKind: null,
      sourceUrl: null,
      sourceAttribution: null,
    }),
  } as unknown as AssessmentsService;
  return { svc: new SlackInteractiveService(prisma, context, approvals, commands, assessments), approvals, commands, assessments, prisma };
}

describe('SlackInteractiveService', () => {
  it('approval:approve calls ApprovalsService.approve', async () => {
    const { svc, approvals } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'approval:approve:ap-1' }] });
    expect(approvals.approve).toHaveBeenCalledWith({ userId: 'u-1', itemId: 'ap-1' });
    expect(msg.text).toContain('Approved');
  });

  it('approval:reject calls ApprovalsService.cancel', async () => {
    const { svc, approvals } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'approval:reject:ap-1' }] });
    expect(approvals.cancel).toHaveBeenCalledWith({
      userId: 'u-1',
      itemId: 'ap-1',
      reason: 'rejected via Slack',
    });
    expect(msg.text).toContain('Rejected');
  });

  it('brief:show_jobs delegates to the commands service', async () => {
    const { svc, commands } = build();
    await svc.handle({ actions: [{ action_id: 'brief:show_jobs' }] });
    expect(commands.jobs).toHaveBeenCalledWith('u-1', 3);
  });

  it('brief:start_quest renders the quest detail', async () => {
    const { svc } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'brief:start_quest', value: 'q-1' }] });
    expect(JSON.stringify(msg)).toContain('Weak on graphs');
  });

  it('job:save tracks the job as an application', async () => {
    const { svc, prisma } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'job:save:j-1' }] });
    expect(prisma.application.create).toHaveBeenCalledOnce();
    expect(msg.text).toContain('Saved');
  });

  it('job:dismiss audits without creating an application', async () => {
    const { svc, prisma } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'job:dismiss:j-1' }] });
    expect(prisma.application.create).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalled();
    expect(msg.text).toContain('Dismissed');
  });

  it('assessment:start fetches a real question', async () => {
    const { svc, assessments } = build();
    const msg = await svc.handle({ actions: [{ action_id: 'assessment:start:s-1' }] });
    expect(assessments.nextKnowledgeQuestion).toHaveBeenCalledWith('u-1', 's-1');
    expect(JSON.stringify(msg)).toContain('topological');
  });

  it('falls back gracefully when the assessment runner throws', async () => {
    const context = { resolveUserId: vi.fn().mockResolvedValue('u-1') } as unknown as SlackContextService;
    const assessments = {
      nextKnowledgeQuestion: vi.fn().mockRejectedValue(new Error('no provider')),
    } as unknown as AssessmentsService;
    const built = new SlackInteractiveService(
      fakePrisma(),
      context,
      { approve: vi.fn(), cancel: vi.fn() } as unknown as ApprovalsService,
      {} as SlackCommandsService,
      assessments,
    );
    const msg = await built.handle({ actions: [{ action_id: 'assessment:start:s-1' }] });
    expect(msg.text).toContain('Assessment Arena');
  });

  it('returns a friendly message when no user exists yet', async () => {
    const context = { resolveUserId: vi.fn().mockResolvedValue(null) } as unknown as SlackContextService;
    const built = new SlackInteractiveService(
      fakePrisma(),
      context,
      { approve: vi.fn(), cancel: vi.fn() } as unknown as ApprovalsService,
      {} as SlackCommandsService,
      {} as AssessmentsService,
    );
    const msg = await built.handle({ actions: [{ action_id: 'brief:show_jobs' }] });
    expect(msg.text).toContain('no user yet');
  });
});
