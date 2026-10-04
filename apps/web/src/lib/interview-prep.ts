import { apiGet, apiPost } from './api-client';

/** F.4 interview-prep client (`/interview-prep/:applicationId`). */

export interface InterviewPrepTopic {
  id: string;
  title: string;
  source: 'job_description' | 'company_dossier' | 'resume_bullet' | 'inferred';
  rationale: string;
  evidenceFactIds: string[];
  suggestedDurationSec: number;
}

export interface InterviewPrepPlan {
  topics: InterviewPrepTopic[];
}

export interface TalkTrack {
  draft: string;
  factRefs: string[];
  cadenceNote?: string;
  generatedAt: string;
  factCheck?: string;
}

export interface InterviewPrepResult {
  id: string;
  plan: InterviewPrepPlan;
  talkTracks: Record<string, TalkTrack>;
}

export interface TalkTrackResult {
  ok: boolean;
  topicId: string;
  talkTrack: TalkTrack | null;
  reason?: string;
}

export function getInterviewPrep(applicationId: string): Promise<InterviewPrepResult | null> {
  return apiGet<InterviewPrepResult | null>(
    `/interview-prep/${encodeURIComponent(applicationId)}`,
  );
}

export function generateInterviewPrep(applicationId: string): Promise<InterviewPrepResult> {
  return apiPost<InterviewPrepResult>(`/interview-prep/${encodeURIComponent(applicationId)}`);
}

export function generateTalkTrack(
  applicationId: string,
  topicId: string,
): Promise<TalkTrackResult> {
  return apiPost<TalkTrackResult>(
    `/interview-prep/${encodeURIComponent(applicationId)}/talk-tracks`,
    { topicId },
  );
}

export interface ApplicationContext {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobCompany: string | null;
  state: string;
}

export function getApplication(id: string): Promise<ApplicationContext> {
  return apiGet<ApplicationContext>(`/me/applications/${encodeURIComponent(id)}`);
}
