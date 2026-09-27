// Block Kit builder tests. Each helper returns a valid Slack `chat.postMessage`
// payload shape and never emits an em dash (Career OS content rule).
import { describe, expect, it } from 'vitest';
import {
  approvalPromptBlock,
  assessmentPromptBlock,
  dailyBriefBlock,
  ephemeralText,
  jobCardBlock,
  type SlackMessage,
} from './slack.block-kit';

function assertShape(msg: SlackMessage) {
  expect(typeof msg.text).toBe('string');
  expect(msg.text.length).toBeGreaterThan(0);
  expect(Array.isArray(msg.blocks)).toBe(true);
  expect(msg.blocks.length).toBeGreaterThan(0);
  for (const b of msg.blocks) {
    expect(b.type).toMatch(/^(section|divider|header|context|actions)$/);
    if (b.type === 'actions') {
      for (const el of b.elements) {
        expect(el.type).toBe('button');
        expect(el.action_id).toBeTruthy();
        expect(el.text.type).toBe('plain_text');
      }
    }
  }
}

function assertNoEmDash(msg: SlackMessage) {
  const walk = JSON.stringify(msg);
  expect(walk.includes('—')).toBe(false);
}

describe('dailyBriefBlock', () => {
  it('returns a valid Slack payload with header + quests + action row', () => {
    const msg = dailyBriefBlock({
      levelLabel: 'L4 (+120 XP)',
      quests: [
        { id: 'q1', title: 'Ship pagination fix' },
        { id: 'q2', title: 'Refactor auth flow' },
      ],
      newJobs: 4,
      marketPulse: 'Go usage up 6% this week',
      streakDays: 12,
    });
    assertShape(msg);
    assertNoEmDash(msg);
    const actions = msg.blocks.find((b) => b.type === 'actions');
    expect(actions?.type).toBe('actions');
    if (actions?.type === 'actions') {
      const ids = actions.elements.map((e) => e.action_id);
      expect(ids).toEqual([
        'brief:start_quest',
        'brief:show_jobs',
        'brief:market_brief',
        'brief:review_progress',
      ]);
    }
  });

  it('handles empty quest list without crashing', () => {
    const msg = dailyBriefBlock({
      levelLabel: 'L1',
      quests: [],
      newJobs: 0,
      marketPulse: 'quiet day',
      streakDays: 0,
    });
    assertShape(msg);
    expect(JSON.stringify(msg)).toContain('No quests queued today');
  });
});

describe('assessmentPromptBlock', () => {
  it('embeds attemptId into action_id for routing', () => {
    const msg = assessmentPromptBlock({
      attemptId: 'att-42',
      topic: 'Postgres MVCC',
      timeLimitMinutes: 15,
    });
    assertShape(msg);
    assertNoEmDash(msg);
    const actions = msg.blocks.find((b) => b.type === 'actions');
    if (actions?.type === 'actions') {
      expect(actions.elements[0].action_id).toBe('assessment:start:att-42');
      expect(actions.elements[1].action_id).toBe('assessment:snooze:att-42');
    }
  });
});

describe('jobCardBlock', () => {
  it('renders match score and three action buttons', () => {
    const msg = jobCardBlock({
      jobId: 'job-9',
      title: 'Staff Engineer',
      company: 'Acme',
      location: 'Remote',
      matchScore: 87,
      url: 'https://example.com/j/9',
    });
    assertShape(msg);
    assertNoEmDash(msg);
    expect(JSON.stringify(msg)).toContain('match 87%');
    const actions = msg.blocks.find((b) => b.type === 'actions');
    if (actions?.type === 'actions') {
      expect(actions.elements.map((e) => e.action_id)).toEqual([
        'job:apply:job-9',
        'job:save:job-9',
        'job:dismiss:job-9',
      ]);
    }
  });

  it('clamps match score into [0, 100]', () => {
    const low = jobCardBlock({
      jobId: 'j', title: 't', company: 'c', location: 'l', matchScore: -5, url: 'https://x/y',
    });
    const high = jobCardBlock({
      jobId: 'j', title: 't', company: 'c', location: 'l', matchScore: 150, url: 'https://x/y',
    });
    expect(JSON.stringify(low)).toContain('match 0%');
    expect(JSON.stringify(high)).toContain('match 100%');
  });
});

describe('approvalPromptBlock', () => {
  it('produces approve (primary) + reject (danger) buttons with ID in action_id', () => {
    const msg = approvalPromptBlock({
      approvalId: 'apr-77',
      action: 'Send cover letter',
      summary: 'Draft targeting Acme Staff Eng role',
    });
    assertShape(msg);
    assertNoEmDash(msg);
    const actions = msg.blocks.find((b) => b.type === 'actions');
    if (actions?.type === 'actions') {
      expect(actions.elements[0].action_id).toBe('approval:approve:apr-77');
      expect(actions.elements[0].style).toBe('primary');
      expect(actions.elements[1].action_id).toBe('approval:reject:apr-77');
      expect(actions.elements[1].style).toBe('danger');
    }
  });
});

describe('ephemeralText', () => {
  it('wraps a string in a valid single-section payload', () => {
    const msg = ephemeralText('Command not found');
    assertShape(msg);
    expect(msg.blocks.length).toBe(1);
    expect(msg.blocks[0].type).toBe('section');
  });
});
