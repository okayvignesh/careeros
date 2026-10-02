'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface MockInterviewQuestion {
  kind: 'technical' | 'behavioral';
  prompt: string;
  keyPoints: string[];
}

interface MockInterviewTask {
  id: string;
  scenario: string;
  questions: MockInterviewQuestion[];
  skillIds: string[];
  difficulty: string;
}

interface GradeResult {
  attemptId: string;
  score: number;
}

export function MockInterviewRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const skillId = search.get('skillId') ?? '';
  const [task, setTask] = useState<MockInterviewTask | null>(null);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the task loads; 0 is a sentinel that is never read before then.
  const startedAt = useRef<number>(0);
  const firstTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const url = skillId
      ? `/assessments/mock-interview/next?skillId=${encodeURIComponent(skillId)}`
      : '/assessments/mock-interview/next';
    apiGet<MockInterviewTask>(url)
      .then((t) => {
        setTask(t);
        startedAt.current = Date.now();
        setTimeout(() => firstTextareaRef.current?.focus(), 0);
      })
      .catch((e) => setError((e as Error).message));
  }, [skillId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!task) return;
    if (answers.some((a) => a.trim().length === 0)) {
      setError('Please answer all three questions before submitting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<GradeResult>('/assessments/mock-interview/grade', {
        questionId: task.id,
        answers,
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

  if (error && !task) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!task) return <Skeleton />;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-6">
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
          {task.skillIds.map((s) => (
            <span key={s} className="font-mono text-fg-faint">
              #{s}
            </span>
          ))}
        </div>
        {task.scenario && <p className="text-[14px] leading-relaxed text-fg-muted">{task.scenario}</p>}
      </section>

      {task.questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
              {q.kind}
            </span>
            <span className="text-[12px] font-medium text-fg-subtle">Question {i + 1} of 3</span>
          </div>
          <p className="text-[15px] leading-relaxed text-fg">{q.prompt}</p>
          <textarea
            ref={i === 0 ? firstTextareaRef : undefined}
            value={answers[i]}
            onChange={(e) => {
              const next = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
            }}
            rows={6}
            required
            className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg focus:border-accent focus:outline-none"
            placeholder={
              q.kind === 'behavioral'
                ? 'One concrete example. Your role, the decision, the outcome.'
                : 'Name the concept, mechanism, and trade-off. Structured beats long.'
            }
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void onSubmit(e as unknown as FormEvent);
              }
            }}
          />
        </div>
      ))}

      {error && task && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div>
        <Button type="submit" disabled={busy || answers.some((a) => a.trim().length === 0)}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : (
            <>
              Submit interview <Send className="h-4 w-4" />
            </>
          )}
        </Button>
        <span className="ml-3 text-[11.5px] text-fg-faint">Cmd/Ctrl+Enter to submit.</span>
      </div>
    </form>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-24 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
