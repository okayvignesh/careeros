import { apiGet, apiPost } from './api-client';

/**
 * Typed client for the F.8 data-portability endpoints and the approval queue.
 *
 *   POST /me/export  -> age-encrypted dump + short-lived presigned URL
 *   POST /me/delete  -> irreversible wipe (fresh re-auth + confirmEmail)
 *   POST /auth/sign-in -> used to mint the fresh re-auth window the two
 *                         endpoints above require (< 5 min session age)
 *   GET  /me/approvals -> the queue; a pending `delete_account` item is shown
 *                         on the data screen so deletion can honour the queue
 */

export interface ExportManifestTable {
  name: string;
  rowCount: number;
  sha256: string;
}

export interface ExportManifest {
  userId: string;
  email: string;
  exportedAt: string;
  schemaVersion: number;
  tables: ExportManifestTable[];
}

export interface ExportResult {
  url: string;
  key: string;
  manifest: ExportManifest;
  encryptedBytes: number;
}

export interface ApprovalItem {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  diffJson: unknown;
  state: string;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  failedReason: string | null;
}

export interface ApprovalPage {
  items: ApprovalItem[];
  nextCursor: string | null;
}

/** Serialize + age-encrypt a full per-table dump; returns a 5-minute download URL. */
export function exportAccountData(): Promise<ExportResult> {
  return apiPost<ExportResult>('/me/export');
}

/**
 * Irreversible delete. The server also requires the session to be younger than
 * 5 minutes, so callers re-authenticate first (see `reauthenticate`).
 */
export function deleteAccount(confirmEmail: string): Promise<void> {
  return apiPost<void>('/me/delete', { confirmEmail });
}

/** Re-enter the account password to refresh the session age. */
export function reauthenticate(email: string, password: string): Promise<{ id: string; email: string }> {
  return apiPost<{ id: string; email: string }>('/auth/sign-in', { email, password });
}

/** Pending approvals; callers filter for `kind === 'delete_account'`. */
export function listPendingApprovals(limit = 50): Promise<ApprovalPage> {
  return apiGet<ApprovalPage>(`/me/approvals?state=pending&limit=${limit}`);
}

/** Compact human size for the export artifact. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
