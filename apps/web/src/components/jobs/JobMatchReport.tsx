'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Building2, CheckCircle2, Target, XCircle } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { listJobs, scoreJob } from '@/lib/jobs';

const KIND_META = {
  strong: { label: 'Strong', cls: 'text-success', Icon: CheckCircle2 },
  weak: { label: 'Partial', cls: 'text-warn', Icon: Target },
  missing: { label: 'Gap', cls: 'text-fg-subtle', Icon: XCircle },
} as const;

/**
 * C-P4.1 match report. The score, readiness, gap and per-skill explanations
 * come straight from `POST /matcher/score` (the same pure scorer the jobs list
 * uses); job metadata is looked up from the paginated `/jobs` list.
 */
export function JobMatchReport({ jobId }: { jobId: string }) {
  const router = useRouter();
  const load = useCallback(async () => {
    const [score, list] = await Promise.all([scoreJob(jobId), listJobs(200, 0)]);
    return { score, job: list.jobs.find((j) => j.id === jobId) ?? null };
  }, [jobId]);
  const { data, error } = useApi(load);
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  async function track() {
    setTracking(true);
    setTrackError(null);
    try {
      await apiPost<{ id: string }>('/me/applications', { jobId });
      router.push('/applications');
    } catch (e) {
      setTrackError((e as Error).message);
      setTracking(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (data === null) return <Loader size={64} label="Loading match report" />;

  const { score, job } = data;
  const pct = Math.round(score.score * 100);
  const readyPct = Math.round(score.readiness * 100);

  return (
    <div className="flex flex-col gap-8" data-testid="match-report">
      <Link
        href="/jobs"
        data-testid="match-report-back"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> All jobs
      </Link>

      <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-[20px] font-medium text-fg">{job?.title ?? 'Job posting'}</h2>
            <span className="text-[13px] text-fg-muted">
              {job?.company ?? 'Unknown company'}
              {job?.location ? ` · ${job.location}` : ''}
              {job?.remote ? ' · remote' : ''}
              {job?.primarySource ? ` · ${job.primarySource}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Metric label="Match" value={`${pct}%`} />
            <Metric label="Readiness" value={`${readyPct}%`} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {job && (
            <a
              href={job.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="match-report-original"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[12.5px] text-fg hover:border-accent/50 hover:text-accent"
            >
              Open original <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {job?.company && (
            <Link
              href={`/dossier/${encodeURIComponent(job.company)}`}
              data-testid="match-report-dossier"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[12.5px] text-fg hover:border-accent/50 hover:text-accent"
            >
              <Building2 className="h-3.5 w-3.5" /> Company dossier
            </Link>
          )}
          <Button size="sm" variant="secondary" data-testid="match-report-track" onClick={track} disabled={tracking}>
            {tracking ? (
              <>
                <ThinkingOrb state="working" size={20} /> Tracking
              </>
            ) : (
              <>
                <Target className="h-3.5 w-3.5" /> Track application
              </>
            )}
          </Button>
        </div>
        {trackError && (
          <div role="alert" data-testid="match-report-error" className="text-[12.5px] text-danger">
            {trackError}
          </div>
        )}
      </section>

      {score.gap.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="match-report-gap">
          <h3 className="text-[15px] font-medium text-fg">What would raise this</h3>
          <ul className="flex flex-col gap-2">
            {score.gap.map((g) => (
              <li
                key={g.skillId}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 text-[13px]"
              >
                <span className="text-fg">{g.skillName}</span>
                <span className="font-mono text-[12px] text-fg-muted tabular-nums">
                  {Math.round(g.currentProf * 100)}% → needs +{Math.round(g.deltaNeeded * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3" data-testid="match-report-explanations">
        <h3 className="text-[15px] font-medium text-fg">Requirement by requirement</h3>
        <ul className="flex flex-col gap-2">
          {score.explanations.map((ex) => {
            const meta = KIND_META[ex.kind];
            return (
              <li
                key={`${ex.kind}:${ex.skillId}`}
                data-testid="match-report-explanation"
                className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13.5px] text-fg">
                    <meta.Icon className={cn('h-3.5 w-3.5', meta.cls)} /> {ex.skillName}
                  </span>
                  <span className={cn('text-[11.5px] uppercase tracking-[0.1em]', meta.cls)}>
                    {meta.label}
                  </span>
                </div>
                <span className="text-[12.5px] text-fg-muted">{ex.note}</span>
                {ex.evidence && ex.evidence.length > 0 && (
                  <span className="flex flex-wrap gap-1.5 text-[11px] text-fg-faint">
                    {ex.evidence.slice(0, 4).map((ev) => (
                      <span
                        key={ev.id}
                        title={`${ev.kind} · ${new Date(ev.observedAt).toLocaleDateString()}`}
                        className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-mono"
                      >
                        {ev.signal}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="font-mono text-[24px] font-medium text-fg tabular-nums">{value}</span>
      <span className="text-[11px] uppercase tracking-[0.12em] text-fg-faint">{label}</span>
    </div>
  );
}
