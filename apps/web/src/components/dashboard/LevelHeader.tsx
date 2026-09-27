'use client';

import { useEffect, useState } from 'react';
import { Flame, Sparkles, Trophy } from 'lucide-react';
import { levelProgressPct, xpToNextLevel } from '@careeros/shared';
import { apiGet } from '@/lib/api-client';

interface LevelSummary {
  overallLevel: number;
  totalXp: number;
  streakDays: number;
  topLevel: number;
  timezone: string;
}

export function LevelHeader() {
  const [data, setData] = useState<LevelSummary | null>(null);

  useEffect(() => {
    // Browser-resolved IANA timezone so streak buckets match the user's local day boundary.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    apiGet<LevelSummary>(`/me/stats/level?tz=${encodeURIComponent(tz)}`)
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const level = data?.overallLevel ?? 1;
  const xp = data?.totalXp ?? 0;
  const pct = levelProgressPct(xp);
  const remaining = xpToNextLevel(xp);

  return (
    <section className="grid grid-cols-1 gap-6 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5 md:grid-cols-[auto_1fr_auto]">
      {/* current level */}
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.12)] tabular-nums">
          <span className="text-[26px] font-semibold text-[hsl(var(--accent))]">{level}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-faint">
            Level
          </span>
          <span className="text-[13px] text-fg-muted">
            Top skill: level <span className="font-medium tabular-nums text-fg">{data?.topLevel ?? 1}</span>
          </span>
        </div>
      </div>

      {/* progress bar */}
      <div className="flex flex-col justify-center gap-2">
        <div className="flex items-baseline justify-between text-[12px] text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--accent))]" strokeWidth={1.7} />
            <span className="tabular-nums text-fg">{xp.toLocaleString()}</span>
            <span className="text-fg-subtle">XP</span>
          </span>
          <span className="text-[11px] text-fg-faint tabular-nums">
            {level >= 100
              ? 'Max level'
              : `${remaining.toLocaleString()} XP to level ${level + 1}`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
          <div
            className="h-full bg-[hsl(var(--accent))] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* streak */}
      <div className="flex items-center gap-4 md:justify-end">
        <div className="flex flex-col text-right">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-faint">
            Streak
          </span>
          <span className="text-[13px] text-fg-muted">
            <span className="tabular-nums text-fg">{data?.streakDays ?? 0}</span>{' '}
            <span className="text-fg-subtle">days</span>
          </span>
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.10)]">
          {(data?.streakDays ?? 0) > 0 ? (
            <Flame className="h-5 w-5 text-[hsl(var(--warn))]" strokeWidth={1.7} />
          ) : (
            <Trophy className="h-5 w-5 text-fg-subtle" strokeWidth={1.7} />
          )}
        </div>
      </div>
    </section>
  );
}
