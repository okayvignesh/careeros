// Slash-command router. Each command name maps to a handler that returns a
// Block Kit payload for the immediate response.
//
// Handlers here are lightweight stubs: they compose the correct block and
// return it. Real work (start a quiz attempt, hit the market-brief composer,
// enqueue a review) is wired up by downstream services in later Wave-E slices.
// The routing table + argument parsing land in this stream so /commands work
// end-to-end from the moment the manifest installs.
//
// ponytail: no framework, no decorator magic. A Map<name, handler> is
// two lines and beats any DI for something this small.
import {
  approvalPromptBlock,
  assessmentPromptBlock,
  dailyBriefBlock,
  ephemeralText,
  jobCardBlock,
  type SlackMessage,
} from './slack.block-kit';

/** Slack posts `application/x-www-form-urlencoded` for slash commands. */
export interface SlackSlashPayload {
  command: string; // e.g. "/quiz"
  text: string; // free-form args, may be ""
  user_id: string;
  channel_id: string;
  team_id: string;
  trigger_id?: string;
  response_url?: string;
}

export type SlashHandler = (p: SlackSlashPayload) => SlackMessage | Promise<SlackMessage>;

// The seven commands from plan/phase-5 §Runtime.
export const SLASH_COMMANDS = [
  '/quiz',
  '/jobs',
  '/approve',
  '/review',
  '/brief',
  '/pause',
  '/resume',
] as const;

export type SlashCommand = (typeof SLASH_COMMANDS)[number];

/**
 * Build the router. Handlers are pure functions of the payload today; when
 * a real service arrives it becomes the second argument and gets closed over.
 */
export function buildSlashRouter(overrides: Partial<Record<SlashCommand, SlashHandler>> = {}):
  Record<SlashCommand, SlashHandler> {
  const table: Record<SlashCommand, SlashHandler> = {
    '/quiz': (p) => {
      // "/quiz [topic]" -> topic defaults to "general" if blank.
      const topic = p.text.trim() || 'general';
      // ponytail: attemptId placeholder; assessments.service will mint the real
      // one when Wave-D wires the trigger. The action_id embeds it either way.
      return assessmentPromptBlock({
        attemptId: `pending:${p.user_id}:${Date.now()}`,
        topic,
        timeLimitMinutes: 15,
      });
    },
    '/jobs': (p) => {
      // "/jobs [n]" -> defaults to 3, clamped to 5 for Slack row limit.
      const requested = Number.parseInt(p.text.trim(), 10);
      const n = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 5) : 3;
      return ephemeralText(`Fetching top ${n} job matches. I will post them here shortly.`);
    },
    '/approve': (p) => {
      // "/approve <id>" -> renders an approval prompt for that id.
      const id = p.text.trim();
      if (!id) return ephemeralText('Usage: `/approve <approval_id>`');
      return approvalPromptBlock({
        approvalId: id,
        action: 'Approve queued item',
        summary: `Confirm approval of \`${id}\`.`,
      });
    },
    '/review': (_p) => ephemeralText('Kicking off a review of yesterday\'s activity.'),
    '/brief': (_p) =>
      // Ephemeral placeholder brief. Real composer lands in stream E.3.
      dailyBriefBlock({
        levelLabel: 'level unknown',
        quests: [],
        newJobs: 0,
        marketPulse: 'Composer not wired yet',
        streakDays: 0,
      }),
    '/pause': (_p) => ephemeralText('Notifications paused. Use `/resume` to turn them back on.'),
    '/resume': (_p) => ephemeralText('Notifications resumed.'),
    ...overrides,
  };
  return table;
}

/**
 * Route a payload. Unknown command returns an ephemeral 'not found' rather
 * than throwing - Slack expects a 200 with a body, not a 4xx.
 */
export async function dispatchSlash(
  payload: SlackSlashPayload,
  router: Record<SlashCommand, SlashHandler> = buildSlashRouter(),
): Promise<SlackMessage> {
  const cmd = payload.command as SlashCommand;
  const handler = router[cmd];
  if (!handler) return ephemeralText(`Unknown command: ${payload.command}`);
  return handler(payload);
}

// Re-export for controller use.
export { jobCardBlock };
