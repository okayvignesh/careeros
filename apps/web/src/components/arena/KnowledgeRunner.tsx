'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpCircle, Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface KnowledgeQuestion {
  id: string;
  prompt: string;
  skillIds: string[];
  difficulty: string;
  answerHint: string | null;
  sourceKind?: string | null;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
}

interface GradeResult {
  attemptId: string;
  score: number;
}

export function KnowledgeRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const skillId = search.get('skillId') ?? '';
  const [question, setQuestion] = useState<KnowledgeQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the question loads; 0 is a sentinel that is never read before then.
  const startedAt = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const url = skillId
      ? `/assessments/knowledge/next?skillId=${encodeURIComponent(skillId)}`
      : '/assessments/knowledge/next';
    apiGet<KnowledgeQuestion>(url)
      .then((q) => {
        setQuestion(q);
        startedAt.current = Date.now();
        // Auto-focus the answer field for keyboard-first flow.
        setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch((e) => setError((e as Error).message));
    // Re-fetch when the skillId query changes (e.g. user hops between remediation CTAs).
  }, [skillId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<GradeResult>('/assessments/knowledge/grade', {
        questionId: question.id,
        answer,
        durationMs: Date.now() - startedAt.current,
      });
      router.push(`/arena/results/${result.attemptId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const difficultyClass = useMemo(() => {
    if (!question) return 'text-fg-faint';
    if (question.difficulty === 'easy') return 'text-success';
    if (question.difficulty === 'medium') return 'text-warning';
    return 'text-danger';
  }, [question]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!question) return <Skeleton />;

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
            {question.difficulty}
          </span>
          {question.skillIds.map((s) => (
            <span key={s} className="font-mono text-fg-faint">
              #{s}
            </span>
          ))}
        </div>
        <p className="text-[16px] leading-relaxed text-fg">{question.prompt}</p>
        {question.sourceAttribution && (
          <p className="text-[11.5px] text-fg-faint">
            {question.sourceAttribution}
            {question.sourceUrl && (
              <>
                {' '}
                <a
                  href={question.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-fg-muted"
                >
                  source
                </a>
              </>
            )}
          </p>
        )}
        {question.answerHint && (
          <div>
            <button
              type="button"
              onClick={() => setShowHint((s) => !s)}
              className="flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {showHint ? 'Hide hint' : 'Show hint (marks the answer as hinted)'}
            </button>
            {showHint && (
              <p className="mt-2 rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
                {question.answerHint}
              </p>
            )}
          </div>
        )}
      </section>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">Your answer</span>
        <textarea
          ref={textareaRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={8}
          required
          className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg focus:border-accent focus:outline-none"
          placeholder="Structured is better than long. Name the concept, then the mechanism, then the trade-off."
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <span className="text-[11.5px] text-fg-faint">Cmd/Ctrl+Enter to submit.</span>
      </label>

      <div>
        <Button type="submit" disabled={busy || !answer.trim()}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Grading
            </>
          ) : (
            <>
              Submit for grading <Send className="h-4 w-4" />
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
      <div className="h-40 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}
