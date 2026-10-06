'use client';

import { ExternalLink, FolderGit2, RefreshCw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Stat, cn } from '@careeros/ui';
import type { LanguageSlice, RepoAnalysis, RepoSkill, WeeklyActivity } from './types';
import { aiTone, colorForIndex, formatDate, monthDay, strengthTone } from './analysis-format';

export interface RepoDetailProps {
  repo: RepoAnalysis;
  onRefresh: () => void;
  refreshing: boolean;
}

export function RepoDetail({ repo, onRefresh, refreshing }: RepoDetailProps) {
  const ai = aiTone(repo.aiAssist.level);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 border-b border-[hsl(var(--border))] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.7} />
            <h2 className="truncate text-[19px] font-semibold tracking-[-0.01em] text-fg">{repo.fullName}</h2>
            {repo.private === true && <Badge>Private</Badge>}
            {repo.private === false && <Badge>Public</Badge>}
          </div>
          <p className="text-[12.5px] text-fg-subtle">
            analysed {formatDate(repo.lastAnalyzedAt)}
            {repo.pushedAt ? ` · last push ${formatDate(repo.pushedAt)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="repo-analysis-refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} strokeWidth={1.8} />
            {refreshing ? 'Syncing…' : 'Re-analyse'}
          </Button>
          <a
            href={`https://github.com/${repo.fullName}`}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="repo-analysis-open-github"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 text-[13px] font-medium text-fg transition-colors hover:bg-[hsl(var(--bg-elev-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
          >
            Open on GitHub
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Commits" value={repo.commits.toLocaleString()} />
        <Stat label="Languages" value={repo.languages.length} />
        <Stat label="Skills" value={repo.skills.length} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px]">Languages</CardTitle>
              <p className="text-[12px] text-fg-subtle">Share of analysed bytes, per repository</p>
            </CardHeader>
            <CardContent>
              <LanguageBar languages={repo.languages} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px]">Skills evidenced by this repository</CardTitle>
              <p className="text-[12px] text-fg-subtle">
                {repo.skills.length} {repo.skills.length === 1 ? 'skill' : 'skills'} · code evidence
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {repo.skills.length === 0 ? (
                <p className="px-6 pb-6 text-[12.5px] text-fg-subtle">No skills evidenced for this repository yet.</p>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border))]">
                  {repo.skills.map((skill) => (
                    <SkillRow key={skill.skillId} skill={skill} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <CardTitle className="text-[14px]">AI assistance likelihood</CardTitle>
              <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold', ai.className)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', ai.dotClassName)} aria-hidden />
                {ai.label}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-[12.5px] leading-relaxed text-fg-muted">{ai.description}</p>
              {repo.aiAssist.meanConfidence != null && (
                <p className="text-[12px] tabular-nums text-fg-subtle">
                  Mean signal {Math.round(repo.aiAssist.meanConfidence * 100)}% · {repo.aiAssist.flaggedCommits}{' '}
                  flagged {repo.aiAssist.flaggedCommits === 1 ? 'commit' : 'commits'}
                </p>
              )}
              <p className="text-[11.5px] leading-relaxed text-fg-faint">
                Source code cannot prove authorship. What matters more is whether you can explain,
                modify and debug this independently.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px]">Commit activity</CardTitle>
              <p className="text-[12px] text-fg-subtle">Weekly, last 12 weeks</p>
            </CardHeader>
            <CardContent>
              <ActivityBars activity={repo.activity} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-2))] px-1.5 py-0.5 text-[10.5px] font-medium text-fg-subtle">
      {children}
    </span>
  );
}

function SkillRow({ skill }: { skill: RepoSkill }) {
  return (
    <li className="flex items-center justify-between gap-3 px-6 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{skill.name}</span>
        <span className="text-[11.5px] tabular-nums text-fg-subtle">
          {skill.evidenceCount} evidence {skill.evidenceCount === 1 ? 'row' : 'rows'}
          {skill.lastSeenAt ? ` · last ${new Date(skill.lastSeenAt).toLocaleDateString()}` : ''}
        </span>
      </span>
      <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums', strengthTone(skill.strength))}>
        strength {skill.strength}
      </span>
    </li>
  );
}

export function LanguageBar({ languages }: { languages: LanguageSlice[] }) {
  if (languages.length === 0) {
    return <p className="text-[12.5px] text-fg-subtle">No language data analysed for this repository yet.</p>;
  }
  const label = languages.map((l) => `${l.name} ${l.percent}%`).join(', ');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={`Language mix: ${label}`}>
        {languages.map((l, i) => (
          <span key={l.skillId} style={{ width: `${l.percent}%`, background: colorForIndex(i) }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {languages.map((l, i) => (
          <li key={l.skillId} className="flex items-center gap-2 text-[12.5px] text-fg-muted">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorForIndex(i) }} />
            {l.name}
            <span className="tabular-nums text-fg-subtle">{l.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivityBars({ activity }: { activity: WeeklyActivity[] }) {
  const max = Math.max(1, ...activity.map((a) => a.commits));
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-14 items-end gap-1"
        role="img"
        aria-label={`Commits per week for the last ${activity.length} weeks`}
      >
        {activity.map((a) => (
          <span
            key={a.weekStart}
            title={`${a.weekStart}: ${a.commits} ${a.commits === 1 ? 'commit' : 'commits'}`}
            className="flex-1 rounded-[3px] bg-[hsl(var(--accent)/0.75)]"
            style={{ height: `${Math.max(2, Math.round((a.commits / max) * 52))}px` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-fg-faint">
        <span>{activity[0] ? monthDay(activity[0].weekStart) : ''}</span>
        <span>{activity.at(-1) ? monthDay(activity.at(-1)!.weekStart) : ''}</span>
      </div>
    </div>
  );
}
