import { apiGet, apiPost } from './api-client';

/**
 * F.5 outreach client.
 *
 * The shipped backend (WS2) gates every outbound message through the approval
 * queue:
 *   POST /outreach              compose draft
 *   GET  /outreach?status=      list
 *   GET  /outreach/:id          one row
 *   POST /outreach/:id/approve  enqueue an `outreach_email` approval item
 *   POST /outreach/:id/send     send the staged Gmail draft (approved only)
 *   POST /outreach/:id/discard  soft delete + cancel any pending approval
 *
 * NOTE: the orchestration brief named `POST /outreach/:id/sent {gmailDraftId?}`;
 * the shipped controller uses `POST /outreach/:id/send` (no body) after the
 * approval worker stages a Gmail draft. This client follows the shipped routes.
 */

export interface OutreachMessage {
  id: string;
  applicationId: string | null;
  templateId: string;
  industryVariant: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  status: string;
  sendAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  gmailDraftId: string | null;
  replyMessageId: string | null;
  generatedAt: string;
}

export interface ComposeInput {
  templateId: string;
  industryVariant?: string;
  applicationId?: string;
  recipient: {
    email: string;
    name?: string;
    role?: string;
    company?: string;
    timezone?: string;
    context?: string;
  };
}

export interface ComposeResult {
  ok: boolean;
  outreachMessageId: string | null;
  subject?: string;
  body?: string;
  sendAt?: string;
  reason?: string;
}

export interface OutreachSendResult {
  ok: boolean;
  alreadySent?: boolean;
  messageId?: string;
  threadId?: string;
}

export interface PendingApprovalItem {
  id: string;
  kind: string;
  state: string;
  payload: unknown;
}

export function composeOutreach(input: ComposeInput): Promise<ComposeResult> {
  return apiPost<ComposeResult>('/outreach', input);
}

export function listOutreach(status?: string): Promise<OutreachMessage[]> {
  return apiGet<OutreachMessage[]>(`/outreach${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

/** Enqueue an `outreach_email` approval item. The message stays `draft`. */
export function requestOutreachApproval(id: string): Promise<{ id: string }> {
  return apiPost<{ id: string }>(`/outreach/${encodeURIComponent(id)}/approve`);
}

/** Send the Gmail draft staged by the approval worker. */
export function sendOutreach(id: string): Promise<OutreachSendResult> {
  return apiPost<OutreachSendResult>(`/outreach/${encodeURIComponent(id)}/send`);
}

export function discardOutreach(id: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/outreach/${encodeURIComponent(id)}/discard`);
}

export function listPendingApprovals(): Promise<{ items: PendingApprovalItem[] }> {
  return apiGet<{ items: PendingApprovalItem[] }>('/me/approvals?state=pending&limit=100');
}

/** Map outreachMessageId -> pending approval item id from the queue. */
export function pendingOutreachApprovalIds(items: PendingApprovalItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'outreach_email') continue;
    const payload = item.payload as { outreachMessageId?: unknown } | null;
    const outreachMessageId = payload?.outreachMessageId;
    if (typeof outreachMessageId === 'string') map.set(outreachMessageId, item.id);
  }
  return map;
}
