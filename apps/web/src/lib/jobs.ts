import { apiGet, apiPost } from './api-client';

/** Match report + dossier client (`/matcher/score`, `/jobs`, `/me/dossier`). */

export interface JobListItem {
  id: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  primarySource: string;
  state: string;
  sourcePostedAt: string | null;
  firstSeenAt: string;
  skillIds: string[];
  match: { score: number | null; matched: number; total: number; missing: string[] };
  aging: boolean;
}

export interface JobsListResponse {
  jobs: JobListItem[];
  total: number;
  rejected: Record<string, number>;
}

export interface GapItem {
  skillId: string;
  skillName: string;
  weight: number;
  currentProf: number;
  deltaNeeded: number;
}

export interface EvidenceRef {
  id: string;
  kind: string;
  signal: string;
  observedAt: string;
}

export interface Explanation {
  kind: 'strong' | 'weak' | 'missing';
  skillId: string;
  skillName: string;
  evidence?: EvidenceRef[];
  note: string;
}

export interface MatchScore {
  jobId: string;
  score: number;
  readiness: number;
  gap: GapItem[];
  explanations: Explanation[];
  computedAt: string;
}

export interface DossierIdentity {
  website: string | null;
  linkedinUrl: string | null;
  employeeCount: number | null;
  hq: string | null;
}
export interface EngineeringBlogPost {
  url: string;
  title: string;
  summary: string;
}
export interface DossierTechSignals {
  stackHints: string[];
  engineeringBlogPosts: EngineeringBlogPost[];
}
export interface ReviewAggregate {
  rating: number;
  count: number;
  url: string;
}
export interface DossierDto {
  id: string;
  companyId: string;
  identity: DossierIdentity;
  techSignals: DossierTechSignals;
  reviews: {
    ambitionbox?: ReviewAggregate;
    comparably?: ReviewAggregate;
    reddit?: { threads: Array<{ url: string; title: string }> };
  };
  interviews: {
    leetcodeDiscuss?: Array<{ url: string; title: string; role: string | null }>;
    glassdoorScraped?: Array<{ url: string; title: string; role: string | null }>;
  };
  recentEvents: {
    fundingRounds: Array<{ kind: string; date: string; url: string; headline: string }>;
    layoffs: Array<{ kind: string; date: string; url: string; headline: string }>;
    productLaunches: Array<{ kind: string; date: string; url: string; headline: string }>;
    acquisitions: Array<{ kind: string; date: string; url: string; headline: string }>;
  };
  synthesis: string;
  factRefs: string[];
  generatedAt: string;
  staleAfter: string;
}

export function scoreJob(jobId: string): Promise<MatchScore> {
  return apiPost<MatchScore>('/matcher/score', { jobId });
}

export function listJobs(limit = 200, offset = 0): Promise<JobsListResponse> {
  return apiGet<JobsListResponse>(`/jobs?limit=${limit}&offset=${offset}`);
}

export function getDossier(companyId: string): Promise<DossierDto> {
  return apiGet<DossierDto>(`/me/dossier/${encodeURIComponent(companyId)}`);
}

export function refreshDossier(companyId: string): Promise<{ jobId: string; status: string; dossier: DossierDto }> {
  return apiPost<{ jobId: string; status: string; dossier: DossierDto }>(
    `/me/dossier/${encodeURIComponent(companyId)}/refresh`,
  );
}

export const JOB_STATE_TONE: Record<string, string> = {
  VERIFIED: 'border-success/35 bg-success/10 text-success',
  DISCOVERED: 'border-accent/40 bg-accent/10 text-accent',
  STALE: 'border-warn/35 bg-warn/10 text-warn',
  CLOSED: 'border-[hsl(var(--border))] text-fg-faint',
};
