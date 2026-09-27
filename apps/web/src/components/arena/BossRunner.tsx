'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Send, Timer, Trophy } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface BossQuestion {
  id: string;
  prompt: string;
  skillIds: string[];
  difficulty: string;
}

interface BossBattleTask {
  id: string;
  milestone: number;
  startedAt: string;
  durationS: number;
  expiresAt: string;
  status: 'active' | 'passed' | 'failed' | 'expired';
  questions: BossQuestion[];
}

interface BossSubmitResult {
  attemptId: string;
  score: number;
  bossStatus: 'passed' | 'failed' | 'expired';
}

export function BossRunner({ id }: { id: string }) {
  const router = useRouter();
  const [task, setTask] = useState<BossBattleTask | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    apiGet<BossBattleTask>(`/assessments/boss/${encodeURIComponent(id)}`)
      .then((t) => {
        setTask(t);
        setAnswers(t.questions.map(() => ''));
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (!task || task.status !== 'active') return;
    const tick = () => setNowMs(Date.now());
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [task]);

  const remainingMs = task ? new Date(task.expiresAt).getTime() - nowMs : 0;
  const remainingS = Math.max(0, Math.floor(remainingMs / 1000));
  const clientExpired = task?.status === 'active' && remainingS === 0;

  const onSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!task) return;
      if (answers.some((a) => a.trim().length === 0)) {
        setError('Please answer all questions before submitting.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await apiPost<BossSubmitResult>(`/assessments/boss/${task.id}/submit`, {
          answers,
        });
        router.push(`/arena/results/${result.attemptId}`);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    },
    [task, answers, router],
  );

  if (error && !task) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!task) return <Skeleton />;

  if (task.status !== 'active') {
    return (
      <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-6">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-fg-subtle" />
          <span className="text-[15px] font-medium text-fg">
            Boss L{task.milestone}: {task.status}
          </span>
        </div>
        <p className="text-[13px] text-fg-muted">
          {task.status === 'passed'
            ? 'Cleared. XP awarded and evidence logged.'
            : task.status === 'expired'
              ? 'The timer ran out before submission. You can retry the milestone.'
              : 'Score under 70%. Try again when ready.'}
        </p>
        <div>
          <Link href="/arena">
            <Button variant="ghost">Back to Arena</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section
        className={cn(
          'flex items-center justify-between gap-4 rounded-[var(--radius)] border px-5 py-4',
          remainingS < 60
            ? 'border-danger/40 bg-danger/10'
            : remainingS < 300
              ? 'border-warning/40 bg-warning/10'
              : 'border-accent/30 bg-accent/5',
        )}
      >
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5 text-accent" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              Boss battle L{task.milestone}
            </span>
            <span className="text-[13px] text-fg-muted">
              Server-authoritative timer. Submit all {task.questions.length} answers before it hits zero.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[22px] font-medium text-fg tabular-nums">
          <Timer className="h-5 w-5" />
          {formatMMSS(remainingS)}
        </div>
      </section>

      {task.questions.map((q, i) => (
        <div key={q.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px] text-fg-muted">
            <span className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-medium uppercase tracking-wider text-fg-subtle">
              {q.difficulty}
            </span>
            {q.skillIds.map((s) => (
              <span key={s} className="font-mono text-fg-faint">
                #{s}
              </span>
            ))}
            <span className="ml-auto font-medium text-fg-subtle">Question {i + 1} of {task.questions.length}</span>
          </div>
          <p className="text-[15px] leading-relaxed text-fg">{q.prompt}</p>
          <textarea
            value={answers[i] ?? ''}
            onChange={(e) => {
              const next = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
            }}
            rows={6}
            required
            disabled={clientExpired}
            className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg focus:border-accent focus:outline-none disabled:opacity-60"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void onSubmit();
              }
            }}
          />
        </div>
      ))}

      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div>
        <Button
          type="submit"
          disabled={busy || clientExpired || answers.some((a) => a.trim().length === 0)}
        >
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : clientExpired ? (
            <>Timer expired</>
          ) : (
            <>
              Submit boss battle <Send className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-20 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
