/** Response shapes served by the API (see apps/api/src/modules/*). */

export interface MobileSession {
  deviceId: string;
  userId: string;
  email: string;
  jwt: string;
  refreshToken: string;
  /** Refresh-token expiry (30d), not the 1h access-token expiry. */
  expiresAt: string;
}

export interface MobileMe {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface JobMatch {
  score: number | null;
  matched: number;
  total: number;
  missing: string[];
}

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
  match: JobMatch;
  aging: boolean;
}

export interface JobsListResponse {
  jobs: JobListItem[];
  total: number;
}

export type ApprovalState = 'pending' | 'approved' | 'sent' | 'failed' | 'cancelled';

export interface ApprovalItem {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  diffJson: unknown;
  state: ApprovalState;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  failedReason: string | null;
}

export interface ApprovalsPage {
  items: ApprovalItem[];
  nextCursor: string | null;
}

export interface DailyBriefPayload {
  userId: string;
  composedAt: string;
  xp: { totalXp: number; deltaLast24h: number };
  streak: { currentDays: number; longestDays: number };
  quests: { id: string; title: string; skillName: string | null; dueAt: string | null }[];
  jobMatches: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    postedAt: string | null;
  }[];
  marketPulse: { risingSkill: string | null; snapshotAt: string | null } | null;
}

export interface BriefLatestRow {
  id: string;
  composedAt: string;
  payload: DailyBriefPayload | null;
}

export interface BriefPreferences {
  userId: string;
  isEnabled: boolean;
  timezone: string;
  sendHourLocal: number;
  channels: string[];
  snoozedUntil: string | null;
  lastSentAt: string | null;
}
