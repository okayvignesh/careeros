'use client';

import { useCallback, useState } from 'react';
import { Github, Gitlab, RefreshCw } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface Day {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  weekday: number;
}

interface Calendar {
  totalContributions: number;
  weeks: Array<{ firstDay: string; days: Day[] }>;
  updatedAt: string | null;
  login: string | null;
}

type Source = 'github' | 'gitlab';

const SOURCES: Array<{ id: Source; label: string; icon: typeof Github }> = [
  { id: 'github', label: 'GitHub', icon: Github },
  { id: 'gitlab', label: 'GitLab', icon: Gitlab },
];

const EMPTY_TEXT: Record<Source, string> = {
  github:
    'Connect GitHub in setup and the calendar fills on the next sync. Click Resync above once the token is saved.',
  gitlab:
    'Connect GitLab in setup and the calendar fills after the first sync. Click Resync above once the token is saved.',
};

const CELL = 11;
const GAP = 3;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Career OS themed: indigo scale, not GitHub green. Level 0 uses the elevated bg
// so it reads as a slot, not empty space. Higher levels ramp accent.
const LEVEL_FILL = [
  'hsl(var(--bg-elev-2))',
  'hsl(var(--accent) / 0.22)',
  'hsl(var(--accent) / 0.45)',
  'hsl(var(--accent) / 0.7)',
  'hsl(var(--accent))',
];

/**
 * Activity heatmap with a GitHub/GitLab toggle. The data body is remounted via
 * `key` when the source changes, so `useApi` starts from a clean loading state
 * and never flashes the previous provider's calendar.
 */
export function ContributionHeatmap() {
  const [source, setSource] = useState<Source>('github');
  return <ActivityHeatmap key={source} source={source} onSelect={setSource} />;
}

function ActivityHeatmap({ source, onSelect }: { source: Source; onSelect: (s: Source) => void }) {
  const [resyncing, setResyncing] = useState(false);
  const meta = SOURCES.find((s) => s.id === source)!;
  const Icon = meta.icon;

  const load = useCallback(
    () => apiGet<Calendar | null>(`/integrations/${source}/contributions`),
    [source],
  );
  const { data: cal, error: err, loading, setError, refetch } = useApi(load);

  // Derive the view state instead of mirroring it in an effect. `loading` only
  // covers the initial mount; a resync keeps the existing calendar visible.
  const state: 'loading' | 'empty' | 'ready' | 'error' = err
    ? 'error'
    : cal && cal.weeks.length > 0
      ? 'ready'
      : loading
        ? 'loading'
        : 'empty';

  async function resync() {
    setResyncing(true);
    try {
      await apiPost(`/integrations/${source}/resync`, {});
      // The worker runs async; poll once after a delay so the freshest calendar shows up.
      setTimeout(() => void refetch(), 4000);
    } catch (e) {
      if (!cal) setError((e as Error).message);
    } finally {
      setResyncing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-fg">{meta.label} activity</span>
            <span className="text-[11.5px] text-fg-subtle">
              {state === 'ready' && cal
                ? `${cal.totalContributions.toLocaleString()} contributions in the last year`
                : state === 'empty'
                  ? 'No contributions synced yet'
                  : state === 'error'
                    ? err ?? 'Failed to load'
                    : 'Loading contribution calendar'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            role="group"
            aria-label="Activity source"
            className="flex items-center rounded-[var(--radius)] border border-[hsl(var(--border))] p-0.5"
          >
            {SOURCES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                data-testid={`activity-source-${id}`}
                aria-pressed={source === id}
                onClick={() => onSelect(id)}
                className={cn(
                  'rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-[11.5px] transition-colors',
                  source === id
                    ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={resync}
            disabled={resyncing}
            data-testid={`${source}-resync`}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            aria-label={`Resync ${meta.label}`}
          >
            {resyncing ? (
              <>
                <ThinkingOrb state="working" size={20} /> Resyncing
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} /> Resync
              </>
            )}
          </button>
        </div>
      </header>

      {state === 'loading' && (
        <div className="grid h-[130px] place-items-center rounded-[var(--radius)] bg-[hsl(var(--bg-elev-2))/0.4]">
          <ThinkingOrb state="searching" size={64} />
        </div>
      )}
      {state === 'empty' && (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[12.5px] text-fg-subtle">
          {EMPTY_TEXT[source]}
        </div>
      )}
      {state === 'ready' && cal && <Grid weeks={cal.weeks} label={`${meta.label} contribution calendar`} />}
      {cal?.updatedAt && state === 'ready' && (
        <div className="text-right text-[10.5px] text-fg-faint">
          Updated {new Date(cal.updatedAt).toLocaleString()}
        </div>
      )}
    </section>
  );
}

function Grid({ weeks, label }: { weeks: Calendar['weeks']; label: string }) {
  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);
  const monthTicks = monthLabelTicks(weeks);

  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={label} width={width + 28} height={height + 20} className="text-fg-subtle">
        {/* month labels */}
        <g>
          {monthTicks.map((t) => (
            <text
              key={t.week}
              x={28 + t.week * (CELL + GAP)}
              y={10}
              fontSize="10"
              fill="currentColor"
            >
              {t.label}
            </text>
          ))}
        </g>
        {/* day labels */}
        <g>
          {DAY_LABELS.map((label2, idx) =>
            label2 ? (
              <text
                key={idx}
                x={0}
                y={20 + idx * (CELL + GAP) + CELL - 1}
                fontSize="10"
                fill="currentColor"
              >
                {label2}
              </text>
            ) : null,
          )}
        </g>
        {/* cells: rely on native SVG <title> for tooltips — matches GitHub's approach and avoids
            hoisting 365 Radix triggers into the DOM. */}
        <g transform={`translate(28, 16)`}>
          {weeks.map((w, weekIdx) =>
            w.days.map((d) => (
              <rect
                key={d.date}
                x={weekIdx * (CELL + GAP)}
                y={d.weekday * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={LEVEL_FILL[d.level]}
              >
                <title>{`${d.count} contribution${d.count === 1 ? '' : 's'} on ${d.date}`}</title>
              </rect>
            )),
          )}
        </g>
      </svg>

      {/* legend */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10.5px] text-fg-faint">
        <span>Less</span>
        {LEVEL_FILL.map((fill, i) => (
          <span
            key={i}
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: fill }}
            aria-hidden
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function monthLabelTicks(weeks: Calendar['weeks']): Array<{ week: number; label: string }> {
  const ticks: Array<{ week: number; label: string }> = [];
  let lastMonth = -1;
  weeks.forEach((w, i) => {
    const d = new Date(w.firstDay);
    const m = d.getUTCMonth();
    if (m !== lastMonth) {
      ticks.push({ week: i, label: MONTHS_SHORT[m]! });
      lastMonth = m;
    }
  });
  return ticks;
}
