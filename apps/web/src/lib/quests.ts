import { apiGet } from './api-client';

/** C-P2.6c quest surface + the skill catalogue needed to label quests. */

export type QuestKind = 'unlock-prereq' | 'sharpen-existing' | 'reach-target';
export type Horizon = 'week' | 'month' | 'quarter';

export interface Quest {
  id: string;
  skillId: string;
  kind: QuestKind;
  priority: number;
  reason: string;
  targetProficiency: number;
  estimatedHours: number;
}

export interface PrereqResponse {
  skillId: string;
  immediatePrereqs: string[];
  unmetPrereqs: string[];
}

export interface SkillRow {
  id: string;
  name: string;
  cluster: string | null;
  level: number;
  proficiency: number;
  confidence: number;
  evidenceCount: number;
  recencyDays: number;
}

export function listQuests(horizon: Horizon = 'week'): Promise<Quest[]> {
  return apiGet<Quest[]>(`/me/quests?horizon=${horizon}`);
}

export function getPrereqs(skillId: string): Promise<PrereqResponse> {
  return apiGet<PrereqResponse>(`/me/quests/prereq/${encodeURIComponent(skillId)}`);
}

export function listSkills(): Promise<SkillRow[]> {
  return apiGet<SkillRow[]>('/me/skills');
}

export const QUEST_KIND_LABEL: Record<QuestKind, string> = {
  'unlock-prereq': 'Prerequisite',
  'sharpen-existing': 'Sharpen',
  'reach-target': 'New target',
};
