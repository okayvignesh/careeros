'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpCircle, Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface DebuggingTask {
  id: string;
  brokenCode: string;
  language: string;
  description: string;
  hint: string;
  skillIds: string[];
  difficulty: string;
}

interface GradeResult {
  attemptId: string;
  score: number;
}

export function DebuggingRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const skillId = search.get('skillId') ?? '';
  const [task, setTask] = useState<DebuggingTask | null>(null);
  const [fix, setFix] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const url = skillId
      ? `/assessments/debugging/next?skillId=${encodeURIComponent(skillId)}`
      : '/assessments/debugging/next';
    apiGet<DebuggingTask>(url)
      .then((t) => {
        setTask(t);
        setFix(t.brokenCode);
        startedAt.current = Date.now();
        setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch((e) => setError((e as Error).message));
  }, [skillId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!task) return;
    if (fix.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<GradeResult>('/assessments/debugging/grade', {
        questionId: task.id,
        fix,
        durationMs: Date.now() - startedAt.current,
      });
      router.push(`/arena/results/${result.attemptId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const difficultyClass = useMemo(() => {
    if (!task) return 'text-fg-faint';
    if (task.difficulty === 'easy') return 'text-success';
    if (task.difficulty === 'medium') return 'text-warning';
    return 'text-danger';
  }, [task]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!task) return <Skeleton />;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-6">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          <span
            className={cn(
              'rounded border px-1.5 py-[1px] font-medium uppercase tracking-wider',
              'border-[hsl(var(--border))]',
              difficultyClass,
            )}
          >
            {task.difficulty}
          </span>
          <span className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-mono text-fg-subtle">
            {task.language}
          </span>
          {task.skillIds.map((s) => (
            <span key={s} className="font-mono text-fg-faint">
              #{s}
            </span>
          ))}
        </div>
        <p className="text-[14px] leading-relaxed text-fg">{task.description}</p>
        {task.hint && (
          <div>
            <button
              type="button"
              onClick={() => setShowHint((s) => !s)}
              className="flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {showHint ? 'Hide hint' : 'Show hint (marks the attempt as hinted)'}
            </button>
            {showHint && (
              <p className="mt-2 rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
                {task.hint}
              </p>
            )}
          </div>
        )}
      </section>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">Your fix (edit in place)</span>
        <textarea
          ref={textareaRef}
          value={fix}
          onChange={(e) => setFix(e.target.value)}
          rows={16}
          required
          spellCheck={false}
          className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.55] text-fg focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <span className="text-[11.5px] text-fg-faint">
          Edit the code above until it does what the description says. Cmd/Ctrl+Enter to submit.
        </span>
      </label>

      <div>
        <Button type="submit" disabled={busy || fix.trim().length === 0}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : (
            <>
              Submit fix <Send className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-52 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-64 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}
