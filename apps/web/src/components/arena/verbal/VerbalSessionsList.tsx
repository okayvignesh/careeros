import Link from 'next/link';
import { ArrowRight, Mic } from 'lucide-react';
import { cn } from '@careeros/ui';
import type { VerbalSessionStatus, VerbalSessionView } from '@/lib/verbal-assessments';

const STATUS_LABEL: Record<VerbalSessionStatus, string> = {
  created: 'Recording',
  transcribed: 'Ready to grade',
  graded: 'Graded',
  failed: 'Transcription failed',
  unavailable: 'Speech-to-text unavailable',
};

function statusTone(status: VerbalSessionStatus): string {
  if (status === 'graded') return 'border-success/30 text-success';
  if (status === 'transcribed') return 'border-accent/40 text-accent';
  if (status === 'unavailable' || status === 'failed') return 'border-warning/40 text-warning';
  return 'border-[hsl(var(--border-strong))] text-fg-subtle';
}

/** Compact history list for `GET /assessments/verbal/sessions`. Pure presentational. */
export function VerbalSessionsList({ sessions }: { sessions: VerbalSessionView[] }) {
  if (sessions.length === 0) {
    return (
      <div
        data-testid="verbal-history-empty"
        className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13px] text-fg-subtle"
      >
        No spoken answers yet. Record one from the verbal runner and it lands here.
      </div>
    );
  }

  return (
    <ul data-testid="verbal-history-list" className="flex flex-col gap-2">
      {sessions.map((session) => (
        <li
          key={session.id}
          data-testid="verbal-history-row"
          className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded border px-1.5 py-[1px] text-[11px] font-medium',
                  statusTone(session.status),
                )}
              >
                {STATUS_LABEL[session.status]}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-fg-faint">
                {session.difficulty}
              </span>
              {session.skillIds.map((skillId) => (
                <span key={skillId} className="font-mono text-[11px] text-fg-faint">
                  #{skillId}
                </span>
              ))}
            </div>
            <p className="line-clamp-2 text-[13.5px] leading-relaxed text-fg">{session.prompt}</p>
            {session.transcript && (
              <p className="line-clamp-1 text-[12.5px] text-fg-subtle">{session.transcript}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-right">
              {session.status === 'graded' && session.score !== null ? (
                <span className="block font-mono text-[18px] font-medium tabular-nums text-fg">
                  {Math.round(session.score * 100)}%
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11.5px] text-fg-faint">
                  <Mic className="h-3 w-3" /> no score
                </span>
              )}
              <span className="block font-mono text-[11px] text-fg-faint">
                {new Date(session.createdAt).toLocaleString()}
              </span>
            </span>
            {session.attemptId && (
              <Link
                href={`/arena/results/${session.attemptId}`}
                className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline"
              >
                View <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
