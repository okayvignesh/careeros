'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface QueueStat {
  name: string;
  isPaused: boolean;
  counts: {
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
    delayed?: number;
  };
}

interface FailedJob {
  id: string | null;
  name: string;
  attemptsMade: number;
  failedReason: string;
  timestamp: number;
  data: unknown;
}

const COUNT_KEYS: Array<keyof QueueStat['counts']> = ['waiting', 'active', 'completed', 'failed', 'delayed'];

export function WorkersPanel() {
  const [stats, setStats] = useState<QueueStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStats(await apiGet<QueueStat[]>('/system/workers'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function loadFailed(name: string) {
    setOpenFailed(name);
    try {
      setFailedJobs(await apiGet<FailedJob[]>(`/system/workers/${name}/failed?limit=25`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRetry(name: string) {
    setBusy(`retry:${name}`);
    try {
      await apiPost(`/system/workers/${name}/retry`);
      await refresh();
      if (openFailed === name) await loadFailed(name);
    } finally {
      setBusy(null);
    }
  }

  async function onTogglePause(name: string, paused: boolean) {
    setBusy(`pause:${name}`);
    try {
      await apiPost(`/system/workers/${name}/${paused ? 'resume' : 'pause'}`);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}
      {stats === null ? (
        <Skeleton />
      ) : (
        <div className="flex flex-col gap-3">
          {stats.map((q) => (
            <QueueRow
              key={q.name}
              q={q}
              busy={busy}
              onRetry={() => onRetry(q.name)}
              onTogglePause={() => onTogglePause(q.name, q.isPaused)}
              onOpenFailed={() => loadFailed(q.name)}
              open={openFailed === q.name}
              failedJobs={openFailed === q.name ? failedJobs : []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  q,
  busy,
  onRetry,
  onTogglePause,
  onOpenFailed,
  open,
  failedJobs,
}: {
  q: QueueStat;
  busy: string | null;
  onRetry: () => void;
  onTogglePause: () => void;
  onOpenFailed: () => void;
  open: boolean;
  failedJobs: FailedJob[];
}) {
  const failed = q.counts.failed ?? 0;
  const active = q.counts.active ?? 0;
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              q.isPaused ? 'bg-warning' : active > 0 ? 'bg-success' : 'bg-fg-faint/60',
            )}
          />
          <span className="font-mono text-[14px] font-medium text-fg">{q.name}</span>
          {q.isPaused && (
            <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wider text-warning">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {failed > 0 && (
            <Button variant="ghost" size="sm" onClick={onRetry} disabled={busy === `retry:${q.name}`}>
              {busy === `retry:${q.name}` ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Retrying
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Retry {failed}
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onTogglePause} disabled={busy === `pause:${q.name}`}>
            {q.isPaused ? (
              <>
                <PlayCircle className="h-4 w-4" /> Resume
              </>
            ) : (
              <>
                <PauseCircle className="h-4 w-4" /> Pause
              </>
            )}
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-5 gap-3">
        {COUNT_KEYS.map((k) => (
          <div
            key={k}
            className={cn(
              'flex flex-col gap-0.5 rounded-[var(--radius)] border px-3 py-2',
              k === 'failed' && failed > 0
                ? 'border-danger/30 bg-danger/5 text-danger'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--bg))]',
            )}
          >
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-fg-subtle">
              {k}
            </span>
            <span className="font-mono text-[16px] font-medium text-fg">{q.counts[k] ?? 0}</span>
          </div>
        ))}
      </div>
      {failed > 0 && (
        <button
          type="button"
          onClick={onOpenFailed}
          className="flex items-center gap-1.5 self-start text-[12px] text-fg-muted hover:text-fg"
        >
          <AlertOctagon className="h-3.5 w-3.5" />
          {open ? 'Hide failed jobs' : `Show ${failed} failed job${failed === 1 ? '' : 's'}`}
        </button>
      )}
      {open && failedJobs.length > 0 && <FailedList jobs={failedJobs} />}
    </section>
  );
}

function FailedList({ jobs }: { jobs: FailedJob[] }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-[hsl(var(--border))] pt-3">
      {jobs.map((j, i) => (
        <div key={j.id ?? `job-${i}`} className="flex flex-col gap-0.5 rounded-[var(--radius)] bg-[hsl(var(--bg))] px-3 py-2 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-fg-subtle">
              {j.name} · {j.id ?? '—'}
            </span>
            <span className="font-mono text-fg-faint">
              {new Date(j.timestamp).toLocaleString()} · {j.attemptsMade} attempts
            </span>
          </div>
          <div className="text-danger/90">{j.failedReason || 'unknown error'}</div>
        </div>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
