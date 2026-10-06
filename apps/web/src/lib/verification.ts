import { apiGet, apiPost } from './api-client';

/**
 * C-P3.2e source-verification client:
 *   GET  /admin/jobs/reject-log          rejected postings + reason
 *   POST /admin/jobs/reject-log/:id/re-verify  re-run verify() and promote
 */

export interface RejectLogRow {
  id: string;
  jobRawId: string | null;
  sourceId: string;
  sourceName: string;
  rejectedAt: string;
  reason: string;
  verdict: string;
}

export interface RejectLogResponse {
  total: number;
  offset: number;
  limit: number;
  rows: RejectLogRow[];
}

export interface ReVerifyResult {
  promoted: boolean;
  verdict: string;
  reasons?: string[];
  normalizedJobId?: string;
}

export function listRejectLog(params: { limit?: number; offset?: number; adapter?: string } = {}): Promise<RejectLogResponse> {
  const qs = new URLSearchParams();
  qs.set('limit', String(params.limit ?? 50));
  qs.set('offset', String(params.offset ?? 0));
  if (params.adapter) qs.set('adapter', params.adapter);
  return apiGet<RejectLogResponse>(`/admin/jobs/reject-log?${qs.toString()}`);
}

export function reVerifyReject(id: string): Promise<ReVerifyResult> {
  return apiPost<ReVerifyResult>(`/admin/jobs/reject-log/${encodeURIComponent(id)}/re-verify`);
}
