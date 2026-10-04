// Mirrors the shape returned by `GET /repository-analysis`
// (apps/api/src/modules/repository-analysis/repository-analysis.service.ts).

export type AiAssistLevel = 'low' | 'medium' | 'high' | 'unavailable';

export interface LanguageSlice {
  skillId: string;
  name: string;
  bytes: number;
  percent: number;
}

export interface RepoSkill {
  skillId: string;
  name: string;
  cluster: string | null;
  evidenceCount: number;
  strength: number;
  lastSeenAt: string | null;
}

export interface WeeklyActivity {
  weekStart: string;
  commits: number;
}

export interface RepoAnalysis {
  repoId: string;
  fullName: string;
  private: boolean | null;
  pushedAt: string | null;
  lastAnalyzedAt: string | null;
  totalBytes: number;
  commits: number;
  languages: LanguageSlice[];
  skills: RepoSkill[];
  aiAssist: {
    level: AiAssistLevel;
    meanConfidence: number | null;
    flaggedCommits: number;
  };
  activity: WeeklyActivity[];
}

export interface RepositoryAnalysisResponse {
  connected: boolean;
  login: string | null;
  repos: RepoAnalysis[];
  totals: {
    repos: number;
    commits: number;
    languages: LanguageSlice[];
    skills: number;
  };
}

export type ViewState = 'loading' | 'error' | 'disconnected' | 'no-data' | 'ready';

export function deriveViewState(
  loading: boolean,
  error: string | null,
  data: RepositoryAnalysisResponse | null,
): ViewState {
  if (loading) return 'loading';
  if (error) return 'error';
  if (!data || !data.connected) return 'disconnected';
  if (data.repos.length === 0) return 'no-data';
  return 'ready';
}
