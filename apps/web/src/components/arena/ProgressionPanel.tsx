'use client';

import { useEffect, useMemo, useState } from 'react';
import { Flame, Sparkles, Trophy, type LucideIcon } from 'lucide-react';
import { cn } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';

interface LevelInfo {
  level: number;
  xpInLevel: number;
  xpToNext: number;
  totalXp: number;
}

interface Progression {
  totalXp: number;
  level: LevelInfo;
  streakDays: number;
  longestStreakDays: number;
  attemptsTotal: number;
  recentXp: Array<{ id: string; reason: string; xp: number; createdAt: string }>;
}

interface TimeseriesPoint {
  date: string;
  xp: number;
}

type WindowDays = 7 | 30;

export function ProgressionPanel() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [prog, setProg] = useState<Progression | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Progression>('/assessments/progression')
      .then(setProg)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    apiGet<TimeseriesPoint[]>(`/assessments/progression/timeseries?days=${windowDays}`)
      .then(setSeries)
      .catch((e) => setError((e as Error).message));
  }, [windowDays]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!prog) return <Skeleton />;

  const progressPct =
    prog.level.xpToNext + prog.level.xpInLevel > 0
      ? (prog.level.xpInLevel / (prog.level.xpInLevel + prog.level.xpToNext)) * 100
      : 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              Level
            </span>
            <span className="font-mono text-[40px] font-medium leading-none text-fg">
              {prog.level.level}
            </span>
          </div>
          <span className="font-mono text-[12px] text-fg-muted">
            {prog.level.xpInLevel.toLocaleString()} / {(prog.level.xpInLevel + prog.level.xpToNext).toLocaleString()} XP
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--bg))]">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
        <span className="text-[12px] text-fg-faint">
          {prog.level.xpToNext > 0
            ? `${prog.level.xpToNext.toLocaleString()} XP to level ${prog.level.level + 1}`
            : 'Max level reached'}
        </span>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Stat icon={Sparkles} label="Total XP" value={prog.totalXp.toLocaleString()} />
        <Stat
          icon={Trophy}
          label="Attempts"
          value={prog.attemptsTotal.toLocaleString()}
          hint={prog.attemptsTotal === 1 ? '1 attempt' : `${prog.attemptsTotal} attempts logged`}
        />
        <Stat
          icon={Flame}
          label="Streak"
          value={`${prog.streakDays}d`}
          hint={
            prog.longestStreakDays > prog.streakDays
              ? `Longest: ${prog.longestStreakDays}d`
              : 'Personal best'
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            XP timeline
          </h2>
          <div className="flex gap-1">
            {[7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  if (d === windowDays) return;
                  // Reset to the skeleton while the new window is fetched.
                  setSeries(null);
                  setWindowDays(d as WindowDays);
                }}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  d === windowDays
                    ? 'bg-accent/15 text-accent'
                    : 'text-fg-muted hover:bg-[hsl(var(--bg-hover))/0.5]',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <Timeline points={series} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Recent XP
        </h2>
        {prog.recentXp.length === 0 ? (
          <EmptyRecent />
        ) : (
          <div className="flex flex-col gap-1">
            {prog.recentXp.map((x) => (
              <div
                key={x.id}
                className="flex items-center justify-between rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2 text-[13px]"
              >
                <span className="font-mono text-fg-subtle">{x.reason}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-fg-faint">
                    {new Date(x.createdAt).toLocaleString()}
                  </span>
                  <span className="font-mono font-medium text-accent">+{x.xp} XP</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Timeline({ points }: { points: TimeseriesPoint[] | null }) {
  const max = useMemo(() => {
    if (!points || points.length === 0) return 1;
    return Math.max(...points.map((p) => p.xp), 1);
  }, [points]);

  if (!points) {
    return <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />;
  }
  const hasAny = points.some((p) => p.xp > 0);
  if (!hasAny) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-8 text-center text-[13px] text-fg-subtle">
        No XP in this window. Complete an attempt to see the trend.
      </div>
    );
  }
  return (
    <div className="flex h-32 items-end gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-3 py-3">
      {points.map((p) => {
        const height = p.xp === 0 ? 2 : Math.max(4, (p.xp / max) * 100);
        return (
          <div key={p.date} className="group relative flex-1">
            <div
              className={cn(
                'w-full rounded-sm transition-colors',
                p.xp === 0 ? 'bg-[hsl(var(--bg))]' : 'bg-accent/60 group-hover:bg-accent',
              )}
              style={{ height: `${height}%` }}
              title={`${p.date} · +${p.xp} XP`}
            />
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-fg-subtle" />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          {label}
        </span>
      </div>
      <div className="font-mono text-[28px] font-medium leading-none text-fg">{value}</div>
      {hint && <div className="text-[12px] text-fg-muted">{hint}</div>}
    </div>
  );
}

function EmptyRecent() {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-8 text-center text-[13px] text-fg-subtle">
      No XP yet. Your first attempt lands here.
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-24 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}

