'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, FileText, Mail } from 'lucide-react';
import { Button } from '@careeros/ui';
import { STATE_LABEL, type ApplicationState } from '@careeros/shared';
import { apiGet, apiPatch } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { Loader } from '@/components/Loader';

export interface ApplicationEvent {
  id: string;
  fromState: string | null;
  toState: string;
  byActor: string;
  notes: string | null;
  at: string;
}

export interface ApplicationDetailDto {
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

export function ApplicationDetail({ id }: { id: string }) {
  const load = useCallback(() => apiGet<ApplicationDetailDto>(`/me/applications/${id}`), [id]);
  const { data: app, error, setError, refetch } = useApi(load);
  const [busy, setBusy] = useState(false);
  const [toState, setToState] = useState<string>('');
  const [transitionNotes, setTransitionNotes] = useState('');
  const [note, setNote] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="application-error"
        className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
      >
        {error}
      </div>
    );
  }
  if (!app) return <Loader label="Loading application" />;

  return (
    <div className="flex flex-col gap-8">
      <Link
        href="/applications"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> All applications
      </Link>

      <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[19px] font-medium text-fg">
              <span className="truncate">{app.jobTitle ?? '(job removed)'}</span>
              {app.jobUrl && (
                <a
                  href={app.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                  title="Open job posting"
                  data-testid="application-job-link"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              )}
            </div>
            {app.jobCompany && <span className="text-[13px] text-fg-muted">{app.jobCompany}</span>}
          </div>
          <StateBadge state={app.state} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-faint">
          {app.appliedAt && <span data-testid="application-applied-at">Applied {formatDateTime(app.appliedAt)}</span>}
          {app.resumeVariantId && (
            <Link
              href={`/resume-variants/${app.resumeVariantId}`}
              data-testid="application-resume-link"
              className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.7} /> Resume variant
            </Link>
          )}
          {app.coverLetterId && (
            <Link
              href={`/cover-letters/${app.coverLetterId}`}
              data-testid="application-cover-link"
              className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={1.7} /> Cover letter
            </Link>
          )}
          <span className="ml-auto">Updated {formatDateTime(app.updatedAt)}</span>
        </div>

        {app.notes && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted" data-testid="application-notes">
            {app.notes}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
          Move the pipeline
        </h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Next application state"
              data-testid="application-transition-select"
              disabled={busy || app.nextStates.length === 0}
              value={toState}
              onChange={(e) => setToState(e.target.value)}
              className="rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {app.nextStates.length === 0 ? 'Terminal state' : 'Move to…'}
              </option>
              {app.nextStates.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              data-testid="application-transition-submit"
              disabled={busy || !toState}
              onClick={() =>
                void run(() =>
                  apiPatch(`/me/applications/${id}/transition`, {
                    toState,
                    ...(transitionNotes ? { notes: transitionNotes } : {}),
                  }).then(() => {
                    setToState('');
                    setTransitionNotes('');
                  }),
                )
              }
            >
              {busy ? 'Saving…' : 'Move'}
            </Button>
          </div>
          <input
            type="text"
            value={transitionNotes}
            onChange={(e) => setTransitionNotes(e.target.value)}
            placeholder="Optional note for this transition"
            aria-label="Transition note"
            className="w-full rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note to this application"
              aria-label="Application note"
              data-testid="application-note-input"
              className="min-w-[220px] flex-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none"
            />
            <Button
              size="sm"
              variant="ghost"
              data-testid="application-note-save"
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(() => apiPatch(`/me/applications/${id}/attach`, { notes: note.trim() }).then(() => setNote('')))
              }
            >
              Save note
            </Button>
          </div>
        </div>
      </section>

      <ApplicationTimeline events={app.events} />
    </div>
  );
}

export function ApplicationTimeline({ events }: { events: ApplicationEvent[] }) {
  return (
    <section className="flex flex-col gap-3" data-testid="application-timeline">
      <h2 className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        Timeline · {events.length} event{events.length === 1 ? '' : 's'}
      </h2>
      {events.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">No events recorded yet.</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((e) => (
            <li
              key={e.id}
              data-testid="application-event"
              className="flex flex-col gap-1 border-l border-[hsl(var(--border))] py-3 pl-4 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-2 text-[13px] text-fg">
                <span className="font-medium">
                  {e.fromState ? `${stateLabel(e.fromState)} → ` : ''}
                  {stateLabel(e.toState)}
                </span>
                <span className="text-[11.5px] uppercase tracking-wider text-fg-faint">{e.byActor}</span>
                <time className="ml-auto text-[11.5px] tabular-nums text-fg-faint">
                  {formatDateTime(e.at)}
                </time>
              </div>
              {e.notes && <p className="text-[12.5px] leading-relaxed text-fg-muted">{e.notes}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
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
      data-testid="application-state-badge"
      className={`rounded border px-2 py-[2px] text-[11px] font-medium uppercase tracking-wider ${tone[state]}`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

function stateLabel(state: string): string {
  return state in STATE_LABEL ? STATE_LABEL[state as ApplicationState] : state;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
