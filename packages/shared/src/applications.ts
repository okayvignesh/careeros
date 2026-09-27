/**
 * Application state machine. Walking-skeleton has 5 non-terminal + 3 terminal
 * states (blueprint §XState config collapses to this shape). Guards enforced
 * in service code (`canTransition`) — DB stores whatever the code writes.
 *
 * ponytail: enum + guard map today; upgrade to XState when transition metadata
 * (guards on shortlist criteria, auto-transitions from ATS API 200s, etc.)
 * grows past a handful of hand-coded checks.
 */

export const APPLICATION_STATES = [
  'interested',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'ghosted',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const TERMINAL_STATES: readonly ApplicationState[] = ['offer', 'rejected', 'ghosted'];

/**
 * Allowed transitions. Every non-terminal state can also transition to
 * `ghosted` (silent drop). Terminal states are absorbing — no unwind path in
 * the walking-skeleton (users can delete + re-add if they need to redo).
 */
const TRANSITIONS: Record<ApplicationState, readonly ApplicationState[]> = {
  interested: ['applied', 'rejected', 'ghosted'],
  applied: ['interviewing', 'rejected', 'ghosted'],
  interviewing: ['offer', 'rejected', 'ghosted'],
  offer: [],
  rejected: [],
  ghosted: [],
};

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/** Human-readable labels for the state-selector UI. */
export const STATE_LABEL: Record<ApplicationState, string> = {
  interested: 'Interested',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
};

/** Which states the user can transition INTO from `from`, for menu rendering. */
export function nextStatesFrom(from: ApplicationState): readonly ApplicationState[] {
  return TRANSITIONS[from];
}
