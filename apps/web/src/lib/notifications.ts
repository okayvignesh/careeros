import { apiGet, apiPost } from './api-client';

/**
 * Typed client for the E.3 daily-brief preference + preview surface
 * (`/brief/*`). The same screen also reads `/integrations` to show which
 * delivery channels are actually connected.
 */

export interface BriefPreferences {
  userId: string;
  isEnabled: boolean;
  timezone: string;
  sendHourLocal: number;
  channels: string[];
  snoozedUntil: string | null;
  lastSentAt: string | null;
}

export interface DailyBriefPayload {
  userId: string;
  composedAt: string;
  xp: { totalXp: number; deltaLast24h: number };
  streak: { currentDays: number; longestDays: number };
  quests: Array<{ id: string; title: string; skillName: string | null; dueAt: string | null }>;
  jobMatches: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    postedAt: string | null;
  }>;
  marketPulse: { risingSkill: string | null; snapshotAt: string | null } | null;
}

export interface LatestBrief {
  id: string;
  composedAt: string;
  payload: DailyBriefPayload | null;
}

export interface IntegrationSummary {
  kind: 'github' | 'slack' | 'gmail';
  status: 'connected' | 'revoked';
  connectedAt: string;
  metadata: Record<string, unknown> | null;
}

export function getBriefPreferences(): Promise<BriefPreferences | null> {
  return apiGet<BriefPreferences | null>('/brief/preferences');
}

export function updateBriefPreferences(input: {
  timezone: string;
  sendHourLocal: number;
  channels: string[];
}): Promise<BriefPreferences> {
  return apiPost<BriefPreferences>('/brief/preferences', input);
}

export function setBriefEnabled(enabled: boolean): Promise<BriefPreferences> {
  return apiPost<BriefPreferences>('/brief/enable', { enabled });
}

export function snoozeBrief(days: number): Promise<BriefPreferences> {
  return apiPost<BriefPreferences>('/brief/snooze', { days });
}

export function previewBrief(): Promise<DailyBriefPayload> {
  return apiPost<DailyBriefPayload>('/brief/preview');
}

export function getLatestBrief(limit = 5): Promise<LatestBrief[]> {
  return apiGet<LatestBrief[]>(`/brief/latest?limit=${limit}`);
}

export function listIntegrations(): Promise<IntegrationSummary[]> {
  return apiGet<IntegrationSummary[]>('/integrations');
}

/** Render a composed payload as the plain text the channel would deliver. */
export function briefToPlainText(payload: DailyBriefPayload): string {
  const lines: string[] = [
    `Career OS — ${new Date(payload.composedAt).toLocaleString()}`,
    `Level: ${payload.xp.totalXp} XP (+${payload.xp.deltaLast24h} in 24h) · streak ${payload.streak.currentDays} days`,
  ];
  if (payload.quests.length > 0) {
    lines.push('', 'Today');
    for (const q of payload.quests) lines.push(`- ${q.title}${q.skillName ? ` (${q.skillName})` : ''}`);
  }
  if (payload.jobMatches.length > 0) {
    lines.push('', 'New matches');
    for (const j of payload.jobMatches) lines.push(`- ${j.title}${j.company ? ` @ ${j.company}` : ''}`);
  }
  if (payload.marketPulse?.risingSkill) {
    lines.push('', `Market: ${payload.marketPulse.risingSkill} is rising.`);
  }
  if (lines.length <= 2) lines.push('', 'Nothing new today.');
  return lines.join('\n');
}
