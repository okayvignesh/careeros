'use client';

import { useEffect, useState } from 'react';
import { Github, RefreshCw } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { apiGet, apiPost } from '@/lib/api-client';

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

export function ContributionHeatmap() {
  const [cal, setCal] = useState<Calendar | null>(null);
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);

  async function load() {
    setState('loading');
    setErr(null);
    try {
      const r = await apiGet<Calendar | null>('/integrations/github/contributions');
      if (!r || r.weeks.length === 0) {
        setState('empty');
      } else {
        setCal(r);
        setState('ready');
      }
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function resync() {
    setResyncing(true);
    try {
      await apiPost('/integrations/github/resync', {});
      // The worker runs async; poll once after a delay so the freshest calendar shows up.
      setTimeout(load, 4000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setResyncing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Github className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-fg">GitHub activity</span>
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
        <button
          type="button"
          onClick={resync}
          disabled={resyncing}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
          aria-label="Resync GitHub"
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
      </header>

      {state === 'loading' && (
        <div className="grid h-[130px] place-items-center rounded-[var(--radius)] bg-[hsl(var(--bg-elev-2))/0.4]">
          <ThinkingOrb state="searching" size={64} />
        </div>
      )}
      {state === 'empty' && (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[12.5px] text-fg-subtle">
          Connect GitHub in setup and the calendar fills on the next sync. Click Resync above once
          the token is saved.
        </div>
      )}
      {state === 'ready' && cal && <Grid weeks={cal.weeks} />}
      {cal?.updatedAt && state === 'ready' && (
        <div className="text-right text-[10.5px] text-fg-faint">
          Updated {new Date(cal.updatedAt).toLocaleString()}
        </div>
      )}
    </section>
  );
}

function Grid({ weeks }: { weeks: Calendar['weeks'] }) {
  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);
  const monthTicks = monthLabelTicks(weeks);

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="GitHub contribution calendar"
        width={width + 28}
        height={height + 20}
        className="text-fg-subtle"
      >
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
          {DAY_LABELS.map((label, idx) =>
            label ? (
              <text
                key={idx}
                x={0}
                y={20 + idx * (CELL + GAP) + CELL - 1}
                fontSize="10"
                fill="currentColor"
              >
                {label}
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
