'use client';

import Link from 'next/link';
import { ArrowUpRight, FolderGit2, Github, RefreshCw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Stat, cn } from '@careeros/ui';
import type { RepoAnalysis, RepositoryAnalysisResponse } from './types';
import { deriveViewState } from './types';
import { RepoDetail } from './RepoDetail';

export interface RepositoryAnalysisViewProps {
  data: RepositoryAnalysisResponse | null;
  loading: boolean;
  error: string | null;
  selectedRepo: RepoAnalysis | null;
  onSelect: (repoId: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  refreshing: boolean;
}

export function RepositoryAnalysisView({
  data,
  loading,
  error,
  selectedRepo,
  onSelect,
  onRefresh,
  onRetry,
  refreshing,
}: RepositoryAnalysisViewProps) {
  const state = deriveViewState(loading, error, data);

  if (state === 'loading') return <AnalysisSkeleton />;
  if (state === 'error') return <ErrorState message={error ?? 'Something went wrong.'} onRetry={onRetry} />;
  if (state === 'disconnected') return <ConnectState />;
  if (state === 'no-data') {
    return <NoDataState onRefresh={onRefresh} refreshing={refreshing} />;
  }
  if (!data) return <ConnectState />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Repositories" value={data.totals.repos} />
        <Stat label="Commits" value={data.totals.commits.toLocaleString()} detail="authored, last 6 months" />
        <Stat label="Languages" value={data.totals.languages.length} detail="mapped to known skills" />
        <Stat label="Skills evidenced" value={data.totals.skills} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <RepoList repos={data.repos} selectedId={selectedRepo?.repoId ?? null} onSelect={onSelect} />
        {selectedRepo ? (
          <RepoDetail repo={selectedRepo} onRefresh={onRefresh} refreshing={refreshing} />
        ) : (
          <p className="text-[13px] text-fg-subtle">Select a repository to see its analysis.</p>
        )}
      </div>
    </div>
  );
}

function RepoList({
  repos,
  selectedId,
  onSelect,
}: {
  repos: RepoAnalysis[];
  selectedId: string | null;
  onSelect: (repoId: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-[13px]">Repositories</CardTitle>
        <p className="text-[11.5px] text-fg-subtle">
          {repos.length} analysed · newest push first
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-[hsl(var(--border))]">
          {repos.map((repo) => {
            const selected = repo.repoId === selectedId;
            return (
              <li key={repo.repoId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  data-testid={`repo-analysis-repo-${repo.repoId}`}
                  onClick={() => onSelect(repo.repoId)}
                  className={cn(
                    'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--accent))]',
                    selected ? 'bg-[hsl(var(--bg-elev-2))]' : 'hover:bg-[hsl(var(--bg-hover))]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.7} />
                    <span className="truncate text-[13px] font-medium text-fg">{repo.fullName}</span>
                    {repo.private === true && (
                      <span className="ml-auto shrink-0 rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                        Private
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 pl-5 text-[11.5px] tabular-nums text-fg-subtle">
                    <span>{repo.commits.toLocaleString()} commits</span>
                    <span>{repo.languages.length} languages</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ConnectState() {
  return (
    <div
      data-testid="repo-analysis-empty"
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-16 text-center"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-2))]">
        <Github className="h-5 w-5 text-fg-subtle" strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-fg">Connect GitHub to analyse your repositories</h2>
        <p className="mx-auto max-w-[46ch] text-[13px] text-fg-muted">
          Repository analysis is built from synced evidence: languages, commits, and the skills they
          demonstrate. Connect an account and run a sync to populate it.
        </p>
      </div>
      <Link
        href="/settings/integrations"
        data-testid="repo-analysis-connect"
        className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] bg-[hsl(var(--accent))] px-4 text-[13.5px] font-medium text-[hsl(var(--accent-fg))] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
      >
        Go to Integrations
        <ArrowUpRight className="h-4 w-4" strokeWidth={1.8} />
      </Link>
    </div>
  );
}

function NoDataState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <div
      data-testid="repo-analysis-nodata"
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-16 text-center"
    >
      <FolderGit2 className="h-8 w-8 text-fg-subtle" strokeWidth={1.4} />
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-fg">No repositories analysed yet</h2>
        <p className="mx-auto max-w-[46ch] text-[13px] text-fg-muted">
          GitHub is connected, but no repository evidence has landed. Trigger a sync and check back
          once the worker finishes.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onRefresh} disabled={refreshing} data-testid="repo-analysis-refresh">
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} strokeWidth={1.8} />
          {refreshing ? 'Syncing…' : 'Run sync'}
        </Button>
        <Link
          href="/settings/integrations"
          className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Integrations
        </Link>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="repo-analysis-error"
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-6 py-14 text-center"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-fg">Couldn’t load repository analysis</h2>
        <p className="mx-auto max-w-[52ch] text-[13px] text-fg-muted">{message}</p>
      </div>
      <Button variant="secondary" onClick={onRetry} data-testid="repo-analysis-retry">
        Try again
      </Button>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div data-testid="repo-analysis-skeleton" className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading repository analysis</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="h-[280px] animate-pulse rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]" />
        <div className="flex flex-col gap-4">
          <div className="h-[180px] animate-pulse rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]" />
          <div className="h-[220px] animate-pulse rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]" />
        </div>
      </div>
    </div>
  );
}
