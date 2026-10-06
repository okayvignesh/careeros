import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ApprovalsService } from '../approvals/approvals.service';
import { SlackCommandsService } from './slack.commands.service';
import type { SlackContextService } from './slack.context';

function fakePrisma(over: Record<string, unknown> = {}): PrismaService {
  return {
    normalizedJob: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'j-1',
          title: 'Backend Engineer',
          company: 'Acme',
          location: 'Remote',
          canonicalUrl: 'https://jobs.test/1',
        },
      ]),
      count: vi.fn().mockResolvedValue(4),
    },
    xpEvent: { aggregate: vi.fn().mockResolvedValue({ _sum: { xp: 120 } }) },
    streak: { findUnique: vi.fn().mockResolvedValue({ currentDays: 5, longestDays: 9 }) },
    remediationTask: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'q-1', reason: 'Weak on graphs', skillId: 's-1' }]),
      count: vi.fn().mockResolvedValue(2),
      findFirst: vi.fn().mockResolvedValue({ id: 'q-1', reason: 'Weak on graphs', skillId: 's-1' }),
    },
    skill: {
      findMany: vi.fn().mockResolvedValue([{ id: 's-1', name: 'Graphs' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 's-1', name: 'Graphs' }),
      findFirst: vi.fn().mockResolvedValue({ id: 's-1', name: 'Graphs' }),
    },
    marketSnapshot: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ statsJson: { topSkills: [{ skillName: 'Rust' }] } }),
    },
    dailyBriefPreference: { upsert: vi.fn().mockResolvedValue({}) },
    approvalItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ap-1',
        kind: 'outreach_email',
        state: 'pending',
        diffJson: { to: 'jane@acme.com', subject: 'Hi', body: 'Body' },
      }),
    },
    attempt: { count: vi.fn().mockResolvedValue(3) },
    application: { count: vi.fn().mockResolvedValue(1) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) },
    ...over,
  } as unknown as PrismaService;
}

function build(prisma = fakePrisma()) {
  const context = { resolveUserId: vi.fn().mockResolvedValue('u-1') } as unknown as SlackContextService;
  const approvals = { enqueue: vi.fn() } as unknown as ApprovalsService;
  return new SlackCommandsService(prisma, context, approvals);
}

describe('SlackCommandsService', () => {
  it('/jobs returns real job cards', async () => {
    const msg = await build().jobs('u-1', 3);
    expect(JSON.stringify(msg)).toContain('Backend Engineer');
    expect(JSON.stringify(msg)).toContain('job:apply:j-1');
  });

  it('/jobs with no jobs returns an honest empty state', async () => {
    const prisma = fakePrisma({
      normalizedJob: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn() },
    });
    const msg = await build(prisma).jobs('u-1', 3);
    expect(msg.text).toContain('No jobs available');
  });

  it('/brief composes from real XP, streak, quests, and market data', async () => {
    const msg = await build().brief('u-1');
    const json = JSON.stringify(msg);
    expect(json).toContain('120 XP');
    expect(json).toContain('Weak on graphs');
    expect(json).toContain('Rust');
  });

  it('/review reports the last-24h counters', async () => {
    const msg = await build().review('u-1');
    const json = JSON.stringify(msg);
    expect(json).toContain('Attempts');
    expect(json).toContain('3');
  });

  it('/approve renders a prompt for a pending item', async () => {
    const msg = await build().approve('u-1', 'ap-1');
    const json = JSON.stringify(msg);
    expect(json).toContain('approval:approve:ap-1');
    expect(json).toContain('jane@acme.com');
  });

  it('/approve explains an unknown id', async () => {
    const prisma = fakePrisma({ approvalItem: { findFirst: vi.fn().mockResolvedValue(null) } });
    const msg = await build(prisma).approve('u-1', 'missing');
    expect(msg.text).toContain('No approval item');
  });

  it('/quiz resolves a skill to a real assessment prompt', async () => {
    const msg = await build().quiz('u-1', 'graph');
    const json = JSON.stringify(msg);
    expect(json).toContain('assessment:start:s-1');
    expect(json).toContain('Graphs');
  });

  it('/quiz reports when no skill matches', async () => {
    const prisma = fakePrisma({ skill: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), findUnique: vi.fn() } });
    const msg = await build(prisma).quiz('u-1', 'zzz');
    expect(msg.text).toContain('No skill matches');
  });

  it('/pause and /resume toggle the daily-brief preference', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ dailyBriefPreference: { upsert } });
    const svc = build(prisma);
    await svc.setEnabled('u-1', false);
    await svc.setEnabled('u-1', true);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ update: { isEnabled: false } }),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ update: { isEnabled: true } }),
    );
  });

  it('router overrides all seven commands and dispatches to the DB-backed handlers', async () => {
    const router = build().router();
    const msg = await router['/jobs']({
      command: '/jobs',
      text: '3',
      user_id: 'U1',
      channel_id: 'C1',
      team_id: 'T1',
    });
    expect(JSON.stringify(msg)).toContain('Backend Engineer');
  });
});
