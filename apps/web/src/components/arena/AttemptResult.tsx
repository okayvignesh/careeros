'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, MinusCircle, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Button, cn } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';

interface LevelInfo {
  level: number;
  xpInLevel: number;
  xpToNext: number;
  totalXp: number;
}

interface AttemptResultData {
  attemptId: string;
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
  xpAwarded: number;
  totalXp: number;
  level: LevelInfo;
  previousLevel: number;
  leveledUp: boolean;
  streakDays: number;
  skillDeltas: Array<{
    skillId: string;
    beforeLevel: number;
    afterLevel: number;
    beforeProficiency: number;
    afterProficiency: number;
  }>;
}

export function AttemptResult({ id }: { id: string }) {
  const [data, setData] = useState<AttemptResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AttemptResultData>(`/assessments/attempts/${id}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const passed = data.score >= 0.7;
  const scorePct = Math.round(data.score * 100);

  return (
    <div className="flex flex-col gap-8">
      {data.leveledUp && (
        <div
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-500 flex items-center justify-between rounded-[var(--radius)] border border-accent/40 bg-accent/10 px-5 py-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-accent" />
            <div className="flex flex-col">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                Level up
              </span>
              <span className="text-[15px] font-medium text-fg">
                You reached level <span className="font-mono text-accent">{data.level.level}</span>
              </span>
            </div>
          </div>
          <span className="font-mono text-[13px] text-fg-muted">
            L{data.previousLevel} <ArrowRight className="inline h-3.5 w-3.5 -translate-y-[1px]" /> L{data.level.level}
          </span>
        </div>
      )}
      <section
        className={cn(
          'flex flex-col gap-3 rounded-[var(--radius)] border px-6 py-6',
          passed ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5',
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              Score
            </span>
            <span className={cn('font-mono text-[48px] font-medium leading-none', passed ? 'text-success' : 'text-warning')}>
              {scorePct}%
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              XP earned
            </span>
            <span className="font-mono text-[28px] font-medium text-fg">+{data.xpAwarded}</span>
          </div>
        </div>
        <p className="text-[13px] leading-relaxed text-fg-muted">{data.reasoning}</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <PointList title="Matched key points" items={data.hits} tone="success" />
        <PointList title="Missed key points" items={data.misses} tone="warning" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Skill deltas
        </h2>
        {data.skillDeltas.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[13px] text-fg-subtle">
            No mapped skills for this question.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.skillDeltas.map((d) => (
              <SkillDeltaRow key={d.skillId} delta={d} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <StatBox label="Total XP" value={data.totalXp.toLocaleString()} />
        <StatBox label="Level" value={data.level.level.toString()} hint={`${data.level.xpToNext} XP to next`} />
        <StatBox label="Streak" value={`${data.streakDays}d`} />
      </section>

      <div className="flex gap-3">
        <Link href="/arena">
          <Button>
            Back to Arena <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function PointList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'warning';
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-4">
      <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">{title}</h3>
      {items.length === 0 ? (
        <span className="text-[12.5px] text-fg-faint">None</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((p) => (
            <li key={p} className="flex items-center gap-2 text-[13px] text-fg">
              {tone === 'success' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <MinusCircle className="h-3.5 w-3.5 text-warning" />
              )}
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillDeltaRow({ delta }: { delta: AttemptResultData['skillDeltas'][number] }) {
  const profDelta = delta.afterProficiency - delta.beforeProficiency;
  const up = profDelta >= 0;
  return (
    <div className="flex items-center justify-between rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5">
      <span className="font-mono text-[13px] text-fg">{delta.skillId}</span>
      <div className="flex items-center gap-4 text-[12px]">
        <span className="font-mono text-fg-muted">
          L{delta.beforeLevel} → L{delta.afterLevel}
        </span>
        <span
          className={cn(
            'flex items-center gap-1 font-mono',
            up ? 'text-success' : 'text-warning',
          )}
        >
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? '+' : ''}
          {profDelta.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        {label}
      </span>
      <span className="font-mono text-[20px] font-medium text-fg">{value}</span>
      {hint && <span className="text-[11.5px] text-fg-faint">{hint}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-40 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
        <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      </div>
    </div>
  );
}
