import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Repository analysis is computed on read from the immutable evidence graph the
// github.sync worker already writes — no persisted snapshot, no invented facts.
// Presence rows (`sourceRef.kind = 'github_repo'`) carry the language bytes the
// GitHub languages endpoint returned; commit-analysis rows carry a sha +
// aiAssistConfidence. Everything below is a projection of those rows.

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
  strength: number; // 1..5, derived from max weightHint + volume
  lastSeenAt: string | null;
}

export interface WeeklyActivity {
  weekStart: string; // ISO date (UTC, Monday)
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

export type AiAssistLevel = 'low' | 'medium' | 'high' | 'unavailable';

export interface RepositoryAnalysis {
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

/** Flat projection of a github evidence row. Dates arrive as Date from Prisma. */
export interface RawEvidenceRow {
  skillId: string;
  skillName: string;
  skillCluster: string | null;
  signal: string;
  weightHint: number | null;
  observedAt: Date;
  createdAt: Date;
  refKind: string;
  repoId: string;
  repoRef: string | null;
  fullName: string | null;
  language: string | null;
  bytes: number | null;
  sha: string | null;
  isPrivate: boolean | null;
  pushedAt: string | null;
  aiConfidence: number | null;
}

const PRESENCE_KIND = 'github_repo';
const AI_FLAG_THRESHOLD = 0.5;
const ACTIVITY_WEEKS = 12;

interface RepoBucket {
  repoId: string;
  fullName: string | null;
  repoRef: string | null;
  private: boolean | null;
  pushedAt: string | null;
  lastAnalyzedAt: Date | null;
  langBytes: Map<string, { name: string; bytes: number }>;
  skills: Map<
    string,
    { name: string; cluster: string | null; count: number; maxWeight: number | null; lastSeenAt: Date | null }
  >;
  commits: Map<string, Date>;
  aiBySha: Map<string, number>;
}

@Injectable()
export class RepositoryAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalysis(userId: string): Promise<RepositoryAnalysis> {
    const integration = await this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'github' } },
      select: { status: true, metadata: true },
    });
    const connected = integration?.status === 'connected';
    if (!connected) return emptyAnalysis(null);

    const login =
      typeof (integration.metadata as Record<string, unknown> | null)?.login === 'string'
        ? ((integration.metadata as Record<string, unknown>).login as string)
        : null;
    const rows = await this.prisma.$queryRaw<RawEvidenceRow[]>`
      SELECT
        e."skillId"                                  AS "skillId",
        s."name"                                     AS "skillName",
        s."cluster"                                  AS "skillCluster",
        e."signal"                                   AS "signal",
        e."weightHint"::float8                       AS "weightHint",
        e."observedAt"                               AS "observedAt",
        e."createdAt"                                AS "createdAt",
        e."sourceRef"->>'kind'                       AS "refKind",
        e."sourceRef"->>'repoId'                     AS "repoId",
        e."sourceRef"->>'repoRef'                    AS "repoRef",
        e."sourceRef"->>'fullName'                   AS "fullName",
        e."sourceRef"->>'language'                   AS "language",
        (e."sourceRef"->>'bytes')::float8            AS "bytes",
        e."sourceRef"->>'sha'                        AS "sha",
        (e."detail"->>'private')::boolean            AS "isPrivate",
        e."detail"->>'pushedAt'                      AS "pushedAt",
        (e."detail"->>'aiAssistConfidence')::float8  AS "aiConfidence"
      FROM evidence e
      JOIN skills s ON s.id = e."skillId"
      WHERE e."userId" = ${userId}::uuid
        AND e.kind = 'code'
        AND e."sourceRef"->>'repoId' IS NOT NULL
      ORDER BY e."observedAt" DESC
      LIMIT 100000
    `;
    return computeRepositoryAnalysis(rows, login);
  }
}

export function emptyAnalysis(login: string | null): RepositoryAnalysis {
  return {
    connected: false,
    login,
    repos: [],
    totals: { repos: 0, commits: 0, languages: [], skills: 0 },
  };
}

/** Strength 1..5 derived from the strongest stored weightHint plus volume. */
export function evidenceStrength(maxWeight: number | null, evidenceCount: number): number {
  const base = maxWeight == null ? 2 : 1 + Math.round(maxWeight * 4);
  const bonus = evidenceCount >= 5 ? 1 : 0;
  return Math.max(1, Math.min(5, base + bonus));
}

export function aiAssistLevel(mean: number | null): AiAssistLevel {
  if (mean == null) return 'unavailable';
  if (mean >= 0.5) return 'high';
  if (mean >= 0.3) return 'medium';
  return 'low';
}

/** Monday-anchored UTC week start as yyyy-mm-dd. */
export function utcWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function skillMap(bucket: RepoBucket, row: RawEvidenceRow) {
  let s = bucket.skills.get(row.skillId);
  if (!s) {
    s = { name: row.skillName, cluster: row.skillCluster, count: 0, maxWeight: null, lastSeenAt: null };
    bucket.skills.set(row.skillId, s);
  }
  s.count += 1;
  if (row.weightHint != null) {
    s.maxWeight = s.maxWeight == null ? row.weightHint : Math.max(s.maxWeight, row.weightHint);
  }
  if (s.lastSeenAt == null || row.observedAt > s.lastSeenAt) s.lastSeenAt = row.observedAt;
}

function finalizeLanguages(bucket: RepoBucket): { languages: LanguageSlice[]; totalBytes: number } {
  const totalBytes = [...bucket.langBytes.values()].reduce((a, l) => a + l.bytes, 0);
  const languages = [...bucket.langBytes.entries()]
    .map(([skillId, l]) => ({
      skillId,
      name: l.name,
      bytes: l.bytes,
      percent: totalBytes > 0 ? Math.round((l.bytes / totalBytes) * 100) : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return { languages, totalBytes };
}

function finalizeSkills(bucket: RepoBucket): RepoSkill[] {
  return [...bucket.skills.entries()]
    .map(([skillId, s]) => ({
      skillId,
      name: s.name,
      cluster: s.cluster,
      evidenceCount: s.count,
      strength: evidenceStrength(s.maxWeight, s.count),
      lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
    }))
    .sort((a, b) => b.strength - a.strength || b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name));
}

function finalizeActivity(bucket: RepoBucket, now: Date): WeeklyActivity[] {
  const byWeek = new Map<string, Set<string>>();
  for (const [sha, at] of bucket.commits) {
    const week = utcWeekStart(at);
    let set = byWeek.get(week);
    if (!set) {
      set = new Set<string>();
      byWeek.set(week, set);
    }
    set.add(sha);
  }
  const out: WeeklyActivity[] = [];
  const thisWeek = new Date(utcWeekStart(now));
  for (let i = ACTIVITY_WEEKS - 1; i >= 0; i--) {
    const d = new Date(thisWeek);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push({ weekStart: key, commits: byWeek.get(key)?.size ?? 0 });
  }
  return out;
}

export function computeRepositoryAnalysis(
  rows: RawEvidenceRow[],
  login: string | null,
  now: Date = new Date(),
): RepositoryAnalysis {
  const buckets = new Map<string, RepoBucket>();
  for (const row of rows) {
    if (!row.repoId) continue;
    let b = buckets.get(row.repoId);
    if (!b) {
      b = {
        repoId: row.repoId,
        fullName: null,
        repoRef: null,
        private: null,
        pushedAt: null,
        lastAnalyzedAt: null,
        langBytes: new Map(),
        skills: new Map(),
        commits: new Map(),
        aiBySha: new Map(),
      };
      buckets.set(row.repoId, b);
    }
    if (row.fullName) b.fullName = b.fullName ?? row.fullName;
    if (row.repoRef) b.repoRef = b.repoRef ?? row.repoRef;
    if (row.isPrivate != null) b.private = row.isPrivate;
    if (row.pushedAt) b.pushedAt = row.pushedAt > (b.pushedAt ?? '') ? row.pushedAt : b.pushedAt;
    if (b.lastAnalyzedAt == null || row.createdAt > b.lastAnalyzedAt) b.lastAnalyzedAt = row.createdAt;

    if (row.refKind === PRESENCE_KIND && row.bytes != null) {
      const cur = b.langBytes.get(row.skillId);
      if (cur) cur.bytes += row.bytes;
      else b.langBytes.set(row.skillId, { name: row.skillName, bytes: row.bytes });
    }

    skillMap(b, row);

    if (row.sha) {
      b.commits.set(row.sha, row.observedAt);
      if (row.aiConfidence != null) b.aiBySha.set(row.sha, row.aiConfidence);
    }
  }

  const repos: RepoAnalysis[] = [...buckets.values()].map((b) => {
    const { languages, totalBytes } = finalizeLanguages(b);
    const aiValues = [...b.aiBySha.values()];
    const meanConfidence = aiValues.length
      ? Math.round((aiValues.reduce((a, c) => a + c, 0) / aiValues.length) * 100) / 100
      : null;
    return {
      repoId: b.repoId,
      fullName: b.fullName ?? b.repoRef ?? `repository ${b.repoId}`,
      private: b.private,
      pushedAt: b.pushedAt,
      lastAnalyzedAt: b.lastAnalyzedAt ? b.lastAnalyzedAt.toISOString() : null,
      totalBytes,
      commits: b.commits.size,
      languages,
      skills: finalizeSkills(b),
      aiAssist: {
        level: aiAssistLevel(meanConfidence),
        meanConfidence,
        flaggedCommits: aiValues.filter((c) => c >= AI_FLAG_THRESHOLD).length,
      },
      activity: finalizeActivity(b, now),
    };
  });

  repos.sort(
    (a, b) =>
      (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') ||
      (b.lastAnalyzedAt ?? '').localeCompare(a.lastAnalyzedAt ?? '') ||
      b.commits - a.commits,
  );

  const accountBytes = new Map<string, { name: string; bytes: number }>();
  const allSkills = new Set<string>();
  let totalCommits = 0;
  for (const r of repos) {
    totalCommits += r.commits;
    for (const l of r.languages) {
      const cur = accountBytes.get(l.skillId);
      if (cur) cur.bytes += l.bytes;
      else accountBytes.set(l.skillId, { name: l.name, bytes: l.bytes });
    }
    for (const s of r.skills) allSkills.add(s.skillId);
  }
  const grandTotal = [...accountBytes.values()].reduce((a, l) => a + l.bytes, 0);
  const totalsLanguages = [...accountBytes.entries()]
    .map(([skillId, l]) => ({
      skillId,
      name: l.name,
      bytes: l.bytes,
      percent: grandTotal > 0 ? Math.round((l.bytes / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  return {
    connected: true,
    login,
    repos,
    totals: { repos: repos.length, commits: totalCommits, languages: totalsLanguages, skills: allSkills.size },
  };
}
