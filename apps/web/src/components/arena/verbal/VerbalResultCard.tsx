import { CheckCircle2, Gauge, MessageSquare, MinusCircle, Sparkles } from 'lucide-react';
import { cn } from '@careeros/ui';
import { parseVerbalDimensions, type AttemptResult } from '@/lib/verbal-assessments';

/**
 * Panel verdict for a graded verbal attempt. Pure presentational — the runner
 * owns transport. No score is ever shown when the result carries none; a
 * missing dimension renders as "not scored" rather than a fabricated figure.
 */
export function VerbalResultCard({ result }: { result: AttemptResult }) {
  const dims = parseVerbalDimensions(result.hits);
  const passed = result.score >= 0.7;
  const scorePct = Math.round(result.score * 100);

  return (
    <section
      data-testid="verbal-result"
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-500',
        'flex flex-col gap-5 rounded-[var(--radius)] border px-6 py-6',
        passed ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5',
      )}
      aria-labelledby="verbal-result-heading"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2
            id="verbal-result-heading"
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle"
          >
            Score
          </h2>
          <span
            data-testid="verbal-result-score"
            className={cn(
              'font-mono text-[48px] font-medium leading-none tabular-nums',
              passed ? 'text-success' : 'text-warning',
            )}
          >
            {scorePct}%
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            XP earned
          </span>
          <span className="font-mono text-[28px] font-medium text-fg tabular-nums">
            +{result.xpAwarded}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DimensionBar
          icon={Gauge}
          label="Technical accuracy"
          value={dims.technicalAccuracy}
          tone="accent"
        />
        <DimensionBar
          icon={MessageSquare}
          label="Communication"
          value={dims.communication}
          tone="success"
        />
      </div>

      <p className="text-[13.5px] leading-relaxed text-fg-muted">{result.reasoning}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <PointList title="Matched key points" items={dims.hits} tone="success" />
        <PointList title="Missed key points" items={result.misses} tone="warning" />
      </div>

      {result.leveledUp && (
        <p className="flex items-center gap-2 text-[12.5px] text-accent" role="status">
          <Sparkles className="h-4 w-4" />
          Level up — you reached level <span className="font-mono">{result.level.level}</span>.
        </p>
      )}
    </section>
  );
}

function DimensionBar({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Gauge;
  label: string;
  value: number | null;
  tone: 'accent' | 'success';
}) {
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[12px] font-medium text-fg-subtle">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="font-mono text-[13px] tabular-nums text-fg">
          {pct === null ? 'not scored' : `${pct}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-[hsl(var(--bg))]">
        <div
          className={cn(
            'h-full motion-safe:transition-[width] motion-safe:duration-500',
            tone === 'accent' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--success))]',
          )}
          style={{ width: `${pct ?? 0}%` }}
        />
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
      <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        {title}
      </h3>
      {items.length === 0 ? (
        <span className="text-[12.5px] text-fg-faint">None</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-fg">
              {tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              )}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
