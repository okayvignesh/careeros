'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface SystemDesignTask {
  id: string;
  scenario: string;
  constraints: string[];
  skillIds: string[];
  difficulty: string;
  rubricId: string;
  rubricVersion: string;
  dimensions: Array<{ id: string; name: string }>;
}

interface GradeResult {
  attemptId: string;
  score: number;
}

const TEMPLATE = `# Problem
Restate the problem in one sentence.

# High-level design
Boxes and arrows in prose. Which service does what.

# Deep dive
Pick 1-2 hard bits and go deeper. Data model, algorithm, or protocol.

# Trade-offs
What did you choose over what, and why.
`;

export function SystemDesignRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const skillId = search.get('skillId') ?? '';
  const [task, setTask] = useState<SystemDesignTask | null>(null);
  const [design, setDesign] = useState(TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the task loads; 0 is a sentinel that is never read before then.
  const startedAt = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const url = skillId
      ? `/assessments/system-design/next?skillId=${encodeURIComponent(skillId)}`
      : '/assessments/system-design/next';
    apiGet<SystemDesignTask>(url)
      .then((t) => {
        setTask(t);
        startedAt.current = Date.now();
        setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch((e) => setError((e as Error).message));
  }, [skillId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!task) return;
    if (design.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<GradeResult>('/assessments/system-design/grade', {
        questionId: task.id,
        design,
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
          {task.skillIds.map((s) => (
            <span key={s} className="font-mono text-fg-faint">
              #{s}
            </span>
          ))}
          <span className="ml-auto font-mono text-fg-faint">rubric {task.rubricVersion}</span>
        </div>
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg">{task.scenario}</p>
        {task.constraints.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              Constraints
            </span>
            <ul className="flex flex-col gap-1">
              {task.constraints.map((c) => (
                <li key={c} className="text-[13px] text-fg-muted">
                  · {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {task.dimensions.map((d) => (
            <span
              key={d.id}
              className="rounded border border-[hsl(var(--border))] px-2 py-[1px] text-[11.5px] text-fg-subtle"
            >
              {d.name}
            </span>
          ))}
        </div>
      </section>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">Your design</span>
        <textarea
          ref={textareaRef}
          value={design}
          onChange={(e) => setDesign(e.target.value)}
          rows={22}
          required
          className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-fg focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <span className="text-[11.5px] text-fg-faint">
          Markdown-flavored is fine. Cmd/Ctrl+Enter to submit.
        </span>
      </label>

      <div>
        <Button type="submit" disabled={busy || design.trim().length === 0}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : (
            <>
              Submit design <Send className="h-4 w-4" />
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
      <div className="h-56 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-64 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}
