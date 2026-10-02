'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface CodeReviewTask {
  id: string;
  diff: string;
  scenario: string;
  language: string;
  skillIds: string[];
  difficulty: string;
  defectCount: number;
}

interface GradeResult {
  attemptId: string;
  score: number;
}

export function CodeReviewRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const skillId = search.get('skillId') ?? '';
  const [task, setTask] = useState<CodeReviewTask | null>(null);
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the task loads; 0 is a sentinel that is never read before then.
  const startedAt = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const url = skillId
      ? `/assessments/code-review/next?skillId=${encodeURIComponent(skillId)}`
      : '/assessments/code-review/next';
    apiGet<CodeReviewTask>(url)
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
    const parsed = findings
      .split('\n')
      .map((f) => f.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter((f) => f.length > 0);
    if (parsed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<GradeResult>('/assessments/code-review/grade', {
        questionId: task.id,
        findings: parsed,
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
          <span className="ml-auto text-fg-faint">{task.defectCount} defects to find</span>
        </div>
        {task.scenario && (
          <p className="text-[14px] leading-relaxed text-fg-muted">{task.scenario}</p>
        )}
        <pre className="max-h-[520px] overflow-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 font-mono text-[12.5px] leading-[1.55]">
          <DiffView diff={task.diff} />
        </pre>
      </section>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">Findings (one per line)</span>
        <textarea
          ref={textareaRef}
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          rows={8}
          required
          className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-fg focus:border-accent focus:outline-none"
          placeholder={
            'Off-by-one on the loop bound.\nMissing null check on the user parameter.\n...'
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <span className="text-[11.5px] text-fg-faint">
          One finding per line. Cmd/Ctrl+Enter to submit.
        </span>
      </label>

      <div>
        <Button type="submit" disabled={busy || !findings.trim()}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : (
            <>
              Submit findings <Send className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <>
      {diff.split('\n').map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || ' '}
        </div>
      ))}
    </>
  );
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-fg-faint';
  if (line.startsWith('@@')) return 'text-accent';
  if (line.startsWith('+')) return 'text-success';
  if (line.startsWith('-')) return 'text-danger';
  return 'text-fg-muted';
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-80 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}
