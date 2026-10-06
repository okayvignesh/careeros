import { apiDelete, apiGet, apiPost } from './api-client';

/**
 * Active-session client for `/auth/sessions` (A-H3 backend). The API masks the
 * IP and derives a human device label server-side; the browser only renders
 * what it is given and can never see another account's rows.
 */
export interface ActiveSession {
  id: string;
  label: string;
  ipMasked: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

/** `GET /auth/sessions`. */
export function listSessions(): Promise<ActiveSession[]> {
  return apiGet<ActiveSession[]>('/auth/sessions');
}

/** `DELETE /auth/sessions/:id`. The server refuses the current session. */
export function revokeSession(id: string): Promise<void> {
  return apiDelete<void>(`/auth/sessions/${encodeURIComponent(id)}`);
}

/** `POST /auth/sessions/revoke-others` — keeps the current session alive. */
export function revokeOtherSessions(): Promise<{ revoked: number }> {
  return apiPost<{ revoked: number }>('/auth/sessions/revoke-others');
}
