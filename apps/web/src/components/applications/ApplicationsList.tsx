'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText, Mail, Trash2 } from 'lucide-react';
import { Button } from '@careeros/ui';
import { STATE_LABEL, type ApplicationState } from '@careeros/shared';
import { apiDelete, apiGet, apiPatch } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface ApplicationEvent {
  id: string;
  fromState: string | null;
  toState: string;
  byActor: string;
  notes: string | null;
  at: string;
}

interface Application {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobCompany: string | null;
  jobUrl: string | null;
  state: ApplicationState;
  appliedAt: string | null;
  resumeVariantId: string | null;
  coverLetterId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  nextStates: ApplicationState[];
  events: ApplicationEvent[];
}

export function ApplicationsList() {
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => apiGet<Application[]>('/me/applications'), []);
  const { data: apps, error, setError, refetch } = useApi(load);

  async function transition(id: string, toState: ApplicationState) {
    setBusyId(id);
    setError(null);
    try {
      await apiPatch<Application>(`/me/applications/${id}/transition`, { toState });
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Stop tracking this application? The event log is deleted too.')) return;
    setBusyId(id);
    setError(null);
    try {
      await apiDelete(`/me/applications/${id}`);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!apps) return <Skeleton />;
  if (apps.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col gap-3">
      {apps.map((a) => (
        <div
          key={a.id}
          className="grid grid-cols-[1fr_auto] gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4 md:grid-cols-[1fr_auto_auto]"
        >
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 truncate text-[15px] font-medium text-fg">
              <Link
                href={`/applications/${a.id}`}
                className="truncate hover:text-[hsl(var(--accent))]"
                data-testid="application-detail-link"
              >
                {a.jobTitle ?? '(job removed)'}
              </Link>
              {a.jobCompany && <span className="text-fg-muted"> @ {a.jobCompany}</span>}
              {a.jobUrl && (
                <a
                  href={a.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline"
                  title="Open job posting"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-faint">
              <StateBadge state={a.state} />
              {a.appliedAt && <span>Applied {formatDate(a.appliedAt)}</span>}
              {a.resumeVariantId && (
                <Link
                  href={`/resume-variants/${a.resumeVariantId}`}
                  className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                >
                  <FileText className="h-3 w-3" /> resume
                </Link>
              )}
              {a.coverLetterId && (
                <Link
                  href={`/cover-letters/${a.coverLetterId}`}
                  className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                >
                  <Mail className="h-3 w-3" /> cover
                </Link>
              )}
              <span className="ml-auto">Updated {formatDate(a.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {a.nextStates.length > 0 ? (
              <select
                aria-label={`Change state for ${a.jobTitle ?? 'application'}`}
                disabled={busyId === a.id}
                value=""
                onChange={(e) => {
                  const next = e.target.value as ApplicationState;
                  if (next) void transition(a.id, next);
                }}
                className="rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-2 py-1 text-[12px] text-fg focus:border-accent focus:outline-none"
              >
                <option value="">Move to...</option>
                {a.nextStates.map((s) => (
                  <option key={s} value={s}>
                    {STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11.5px] text-fg-faint">terminal</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(a.id)}
              disabled={busyId === a.id}
              title="Stop tracking"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StateBadge({ state }: { state: ApplicationState }) {
  const tone: Record<ApplicationState, string> = {
    interested: 'border-[hsl(var(--border))] text-fg-subtle',
    applied: 'border-accent/40 bg-accent/10 text-accent',
    interviewing: 'border-warning/30 bg-warning/10 text-warning',
    offer: 'border-success/40 bg-success/10 text-success',
    rejected: 'border-danger/30 bg-danger/10 text-danger',
    ghosted: 'border-[hsl(var(--border))] text-fg-faint',
  };
  return (
    <span
      className={`rounded border px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wider ${tone[state]}`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-12 text-center">
      <p className="text-[13.5px] text-fg-muted">
        No applications yet. Head to{' '}
        <Link href="/jobs" className="underline hover:text-fg">
          Jobs
        </Link>{' '}
        and click Track on a role.
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
