// Block Kit JSON builders for outbound Slack posts.
//
// Every helper here returns a `{ text, blocks }` shape that maps 1:1 onto
// `chat.postMessage`. `text` is the fallback for notification previews (Slack
// requires it even when `blocks` is present).
//
// ponytail: hand-rolled JSON, no @slack/block-kit dep. The schema is stable
// and typed via SlackBlock so a rename in Slack's docs is a one-file fix.
//
// House rules (also enforced in tests):
//   1. No em dashes anywhere in user-facing strings.
//   2. Every "action" block carries an `action_id` the interactive handler
//      can route on.
//   3. `dailyBriefBlock` groups actions so a Slack layout renders them as a
//      single button row (max 5 per row per Slack limits).

export type SlackBlock =
  | { type: 'section'; text?: { type: 'mrkdwn' | 'plain_text'; text: string; emoji?: boolean }; fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }> }
  | { type: 'divider' }
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji?: boolean } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }> }
  | {
      type: 'actions';
      block_id?: string;
      elements: Array<{
        type: 'button';
        action_id: string;
        text: { type: 'plain_text'; text: string; emoji?: boolean };
        value?: string;
        style?: 'primary' | 'danger';
        url?: string;
      }>;
    };

export interface SlackMessage {
  text: string; // fallback for notifications
  blocks: SlackBlock[];
}

export interface DailyBriefInput {
  levelLabel: string; // e.g. "L4 -> L4 (+120 XP)"
  quests: Array<{ id: string; title: string }>; // top 3
  newJobs: number;
  marketPulse: string; // one-liner
  streakDays: number;
}

/**
 * Morning brief. Actions row: Start quest, Show jobs, Market brief, Review progress.
 * Ties to blueprint §11 (daily integration).
 */
export function dailyBriefBlock(input: DailyBriefInput): SlackMessage {
  const questLines = input.quests.length
    ? input.quests.map((q, i) => `${i + 1}. ${q.title}`).join('\n')
    : '_No quests queued today._';
  return {
    text: `Daily brief: ${input.levelLabel}, ${input.newJobs} new jobs`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Daily brief', emoji: true } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Daily brief' },
        fields: [
          { type: 'mrkdwn', text: `*Level*\n${input.levelLabel}` },
          { type: 'mrkdwn', text: `*Streak*\n${input.streakDays}d` },
          { type: 'mrkdwn', text: `*New jobs*\n${input.newJobs}` },
          { type: 'mrkdwn', text: `*Market pulse*\n${input.marketPulse}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Top quests*\n${questLines}` } },
      {
        type: 'actions',
        block_id: 'daily_brief_actions',
        elements: [
          {
            type: 'button',
            action_id: 'brief:start_quest',
            text: { type: 'plain_text', text: 'Start quest' },
            value: input.quests[0]?.id ?? '',
            style: 'primary',
          },
          {
            type: 'button',
            action_id: 'brief:show_jobs',
            text: { type: 'plain_text', text: 'Show jobs' },
          },
          {
            type: 'button',
            action_id: 'brief:market_brief',
            text: { type: 'plain_text', text: 'Market brief' },
          },
          {
            type: 'button',
            action_id: 'brief:review_progress',
            text: { type: 'plain_text', text: 'Review progress' },
          },
        ],
      },
    ],
  };
}

export interface AssessmentPromptInput {
  attemptId: string;
  topic: string;
  timeLimitMinutes: number;
}

/**
 * Ephemeral prompt in response to `/quiz <topic>`. Start button dispatches
 * `assessment:start:<attemptId>` on the interactive endpoint.
 */
export function assessmentPromptBlock(input: AssessmentPromptInput): SlackMessage {
  return {
    text: `Quiz ready: ${input.topic}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Knowledge quiz' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Topic:* ${input.topic}\n*Time limit:* ${input.timeLimitMinutes} min`,
        },
      },
      {
        type: 'actions',
        block_id: 'assessment_prompt',
        elements: [
          {
            type: 'button',
            action_id: `assessment:start:${input.attemptId}`,
            text: { type: 'plain_text', text: 'Start now' },
            style: 'primary',
            value: input.attemptId,
          },
          {
            type: 'button',
            action_id: `assessment:snooze:${input.attemptId}`,
            text: { type: 'plain_text', text: 'Snooze 1h' },
            value: input.attemptId,
          },
        ],
      },
    ],
  };
}

export interface JobCardInput {
  jobId: string;
  title: string;
  company: string;
  location: string;
  matchScore: number; // 0..100
  url: string;
}

/** Single job card. Used inline in `/jobs` and daily brief expansion. */
export function jobCardBlock(input: JobCardInput): SlackMessage {
  const scorePct = Math.round(Math.max(0, Math.min(100, input.matchScore)));
  return {
    text: `${input.title} at ${input.company}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${input.url}|${input.title}>*\n${input.company} · ${input.location} · match ${scorePct}%`,
        },
      },
      {
        type: 'actions',
        block_id: `job_card:${input.jobId}`,
        elements: [
          {
            type: 'button',
            action_id: `job:apply:${input.jobId}`,
            text: { type: 'plain_text', text: 'Apply' },
            style: 'primary',
            value: input.jobId,
          },
          {
            type: 'button',
            action_id: `job:save:${input.jobId}`,
            text: { type: 'plain_text', text: 'Save' },
            value: input.jobId,
          },
          {
            type: 'button',
            action_id: `job:dismiss:${input.jobId}`,
            text: { type: 'plain_text', text: 'Dismiss' },
            value: input.jobId,
          },
        ],
      },
    ],
  };
}

export interface ApprovalPromptInput {
  approvalId: string;
  action: string; // e.g. "Send cover letter"
  summary: string; // 1-2 line diff preview
}

/**
 * Approval prompt for controlled-execution items (Wave F). Approve/reject
 * buttons dispatch `approval:approve:<id>` / `approval:reject:<id>`.
 */
export function approvalPromptBlock(input: ApprovalPromptInput): SlackMessage {
  return {
    text: `Approval needed: ${input.action}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Approval needed' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${input.action}*` } },
      { type: 'section', text: { type: 'mrkdwn', text: input.summary } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `ref \`${input.approvalId}\`` }] },
      {
        type: 'actions',
        block_id: `approval:${input.approvalId}`,
        elements: [
          {
            type: 'button',
            action_id: `approval:approve:${input.approvalId}`,
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            value: input.approvalId,
          },
          {
            type: 'button',
            action_id: `approval:reject:${input.approvalId}`,
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            value: input.approvalId,
          },
        ],
      },
    ],
  };
}

/**
 * Ephemeral plain-text reply for cases where a block is overkill (errors,
 * short confirmations). Slash-command handlers return this shape.
 */
export function ephemeralText(text: string): SlackMessage {
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
}
