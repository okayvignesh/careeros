import { apiDelete, apiGet, apiPost } from './api-client';

/** E.7 inbox triage client: `/inbox/*` + the application picker source. */

export interface InboxItem {
  id: string;
  emailId: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  class: string;
  classConfidence: number;
  linkedApplicationId: string | null;
  status: string;
  arrivedAt: string;
  reviewedAt: string | null;
}

export interface ApplicationOption {
  id: string;
  jobTitle: string | null;
  jobCompany: string | null;
  state: string;
}

export interface InboxFilter {
  status?: string;
  classFilter?: string;
  limit?: number;
}

export function listInbox(filter: InboxFilter = {}): Promise<InboxItem[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.classFilter) params.set('class', filter.classFilter);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return apiGet<InboxItem[]>(`/inbox${qs ? `?${qs}` : ''}`);
}

export function listApplications(): Promise<ApplicationOption[]> {
  return apiGet<ApplicationOption[]>('/me/applications');
}

export function linkInboxItem(id: string, applicationId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/inbox/${encodeURIComponent(id)}/link`, { applicationId });
}

export function unlinkInboxItem(id: string): Promise<void> {
  return apiDelete<void>(`/inbox/${encodeURIComponent(id)}/link`);
}

export function dismissInboxItem(id: string): Promise<void> {
  return apiPost<void>(`/inbox/${encodeURIComponent(id)}/dismiss`);
}

const CLASS_LABELS: Record<string, string> = {
  recruiter: 'Recruiter',
  interview_invite: 'Interview',
  assessment: 'Assessment',
  rejection: 'Rejection',
  offer: 'Offer',
  job_alert_linkedin: 'Job alert',
  job_alert_indeed: 'Job alert',
  job_alert_naukri: 'Job alert',
  other: 'Other',
};

export function classLabel(value: string): string {
  return CLASS_LABELS[value] ?? value;
}

/** Classes that warrant attention first, in the order triage should surface them. */
export const ACTION_CLASSES = ['interview_invite', 'offer', 'assessment', 'recruiter'] as const;
