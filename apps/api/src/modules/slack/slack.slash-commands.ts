// Slash-command router. Each command name maps to a handler that returns a
// Block Kit payload for the immediate response.
//
// Production wires the real handlers from `SlackCommandsService.router()`
// (DB-backed jobs/brief/review/approve/quiz/pause/resume) into
// `buildSlashRouter(overrides)`. The defaults below are the reference table
// used by routing unit tests and by any future transport that has not yet
// supplied an override; `dispatchSlash` is always called with an explicit
// router by the controller.
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
      // Reference handler: "/quiz [topic]" defaults to "general". Production
      // resolves the topic to a real skill and embeds its id.
      const topic = p.text.trim() || 'general';
      return assessmentPromptBlock({
        attemptId: p.user_id || 'unset',
        topic,
        timeLimitMinutes: 15,
      });
    },
    '/jobs': (p) => {
      // Reference handler: "/jobs [n]" clamps to 1..5. Production overrides
      // this with SlackCommandsService.jobs(), which fetches real matches.
      const requested = Number.parseInt(p.text.trim(), 10);
      const n = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 5) : 3;
      return ephemeralText(`Top ${n} job matches.`);
    },
    '/approve': (p) => {
      // "/approve <id>" -> renders an approval prompt for that id. Production
      // resolves the item and refuses unknown/decided ids.
      const id = p.text.trim();
      if (!id) return ephemeralText('Usage: `/approve <approval_id>`');
      return approvalPromptBlock({
        approvalId: id,
        action: 'Approve queued item',
        summary: `Confirm approval of \`${id}\`.`,
      });
    },
    '/review': (_p) => ephemeralText('Review of recent activity.'),
    '/brief': (_p) =>
      // Reference brief. Production overrides with real XP/quests/jobs.
      dailyBriefBlock({
        levelLabel: 'not loaded',
        quests: [],
        newJobs: 0,
        marketPulse: 'not loaded',
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
