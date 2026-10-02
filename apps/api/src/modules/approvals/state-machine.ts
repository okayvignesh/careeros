/**
 * F.1: approval-item state machine. Plain object of legal transitions - no
 * XState (spec limits XState to the P4 job-application pipeline; this queue's
 * transitions are a handful of one-hops that don't need a runtime engine).
 *
 * Transitions:
 *   pending   -> approved, cancelled
 *   approved  -> sent, failed
 *   sent      -> (terminal)
 *   failed    -> (terminal)
 *   cancelled -> (terminal)
 *
 * `canTransition(from, to)` returns true iff the edge exists. Illegal writes
 * are caught in the service via `assertTransition` which throws
 * `IllegalStateError`.
 */

export const APPROVAL_STATES = [
  'pending',
  'approved',
  'sent',
  'failed',
  'cancelled',
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_KINDS = [
  'ats_submit',
  'agent_form_fill',
  'outreach_email',
  'slack_dm',
  'delete_account',
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

const TRANSITIONS: Record<ApprovalState, readonly ApprovalState[]> = {
  pending: ['approved', 'cancelled'],
  approved: ['sent', 'failed'],
  sent: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function isApprovalState(x: string): x is ApprovalState {
  return (APPROVAL_STATES as readonly string[]).includes(x);
}

export function isApprovalKind(x: string): x is ApprovalKind {
  return (APPROVAL_KINDS as readonly string[]).includes(x);
}

/**
 * Which kinds always require fresh re-auth on approve, regardless of bulk
 * threshold. `delete_account` is the obvious one - anything else that touches
 * an account-destructive path should be added here.
 *
 * ponytail: hard-coded set today. Move to a per-kind config table when a
 * second dimension (per-user override, per-org policy) shows up.
 */
export const KINDS_REQUIRING_FRESH_REAUTH: ReadonlySet<ApprovalKind> = new Set([
  'delete_account',
]);

/**
 * Bulk-approval threshold. More than this in a single request forces fresh
 * re-auth even if none of the individual kinds require it.
 */
export const BULK_APPROVAL_THRESHOLD = 5;

/** Op-tag passed to SensitivityGateService.hasFreshReauth for approval flows. */
export const APPROVAL_REAUTH_OP = 'approval.decide';

export class IllegalStateError extends Error {
  constructor(
    readonly from: ApprovalState | string,
    readonly to: ApprovalState | string,
  ) {
    super(`Illegal approval transition: ${from} -> ${to}`);
    this.name = 'IllegalStateError';
  }
}

export function assertTransition(from: string, to: ApprovalState): void {
  if (!isApprovalState(from)) throw new IllegalStateError(from, to);
  if (!canTransition(from, to)) throw new IllegalStateError(from, to);
}
