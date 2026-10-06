// F.5: outreach send queue. The API is the producer (on approval it stages a
// Gmail draft + schedules the due-send); the worker is the consumer. The queue
// name is pinned in-app, matching the QUEUE_GITLAB precedent in
// apps/worker/src/main.ts, until packages/shared adopts it (WS2 owns neither
// packages/shared nor the shared-file churn that would need).
export const QUEUE_OUTREACH_SEND = 'outreach-send';
export const JOB_OUTREACH_SEND = 'send-due';

export interface OutreachSendPayload {
  userId: string;
  outreachMessageId: string;
}

/** Deterministic, idempotent BullMQ job id. */
export function outreachSendJobId(outreachMessageId: string): string {
  return `outreach-send:${outreachMessageId}`;
}
