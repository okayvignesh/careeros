'use client';

import { useCallback, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { Sparkline } from './Sparkline';
import { trendSignalsView, type TrendSignalsView } from './market-data';

/**
 * Screen 34: technology signals.
 *
 * Backed by `GET /me/market/trends` (90-day job mentions). Empty is a real
 * empty state; `UnavailableNotice` is reserved for load/validation failures.
 */

export type { TrendSignal } from '@careeros/shared';

const trajectoryLabel = {
  rising: 'Rising',
  steady: 'Steady',
  declining: 'Declining',
} as const;

const trajectoryClass = {
  rising: 'text-[hsl(var(--accent))]',
  steady: 'text-fg-subtle',
  declining: 'text-[hsl(var(--warn))]',
} as const;

export function TrendSignalsPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiGet<unknown>('/me/market/trends');
    return trendSignalsView(res);
  }, []);
  const { data, error } = useApi<TrendSignalsView>(load);

  if (error) {
    return <UnavailableNotice feature="Trend signals" />;
  }

  if (data === null) return <Loader size={64} label="Loading trend signals" />;

  if (data.signals.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
        <p className="text-fg-muted text-[13.5px]">
          No trend signals yet. Signals appear once the weekly market refresh runs against your job
          pool and news sources.
        </p>
      </div>
    );
  }

  const selected = data.signals.find((r) => r.id === selectedId) ?? data.signals[0]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-fg-faint border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em]">
              <th className="px-4 py-2.5">Technology</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Mentions</th>
              <th className="px-4 py-2.5 text-right">Sources</th>
              <th className="px-4 py-2.5">Trajectory</th>
            </tr>
          </thead>
          <tbody>
            {data.signals.map((r) => {
              const active = r.id === selected.id;
              return (
                <tr
                  key={r.id}
                  data-testid="trend-signal-row"
                  onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer border-b border-[hsl(var(--border))] last:border-0 ${
                    active ? 'bg-[hsl(var(--bg-elev-2))]' : 'hover:bg-[hsl(var(--bg-hover))/0.5]'
                  }`}
                >
                  <td className="text-fg px-4 py-3">{r.technology}</td>
                  <td className="text-fg-muted px-4 py-3">{r.category}</td>
                  <td className="text-fg-muted px-4 py-3 text-right font-mono tabular-nums">
                    {r.mentions.toLocaleString()}
                  </td>
                  <td className="text-fg-muted px-4 py-3 text-right font-mono tabular-nums">
                    {r.sources}
                  </td>
                  <td className={`px-4 py-3 text-[12px] ${trajectoryClass[r.trajectory]}`}>
                    {trajectoryLabel[r.trajectory]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-fg-faint text-[10.5px] font-medium uppercase tracking-[0.14em]">
                {selected.category}
              </div>
              <div className="text-fg text-[18px] font-semibold">{selected.technology}</div>
            </div>
            <div className={`text-[12px] ${trajectoryClass[selected.trajectory]}`}>
              {trajectoryLabel[selected.trajectory]}
            </div>
          </div>
          <div className="mt-4">
            <Sparkline
              values={selected.history}
              width={320}
              height={72}
              ariaLabel={`${selected.technology} mentions over time`}
              tone={selected.trajectory}
            />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <dt className="text-fg-faint">Mentions</dt>
            <dd className="text-fg text-right font-mono tabular-nums">
              {selected.mentions.toLocaleString()}
            </dd>
            <dt className="text-fg-faint">Sources</dt>
            <dd className="text-fg text-right font-mono tabular-nums">{selected.sources}</dd>
            <dt className="text-fg-faint">First seen</dt>
            <dd className="text-fg text-right font-mono tabular-nums">{selected.firstSeen}</dd>
          </dl>
        </div>

        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
          <div className="text-fg-faint text-[10.5px] font-medium uppercase tracking-[0.14em]">
            How a signal becomes a quest
          </div>
          <ol className="text-fg-muted mt-3 flex flex-col gap-3 text-[12.5px]">
            <li className="flex gap-3">
              <span className="text-fg-subtle grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px]">
                1
              </span>
              <span>
                Signal crosses the mentions floor for two consecutive weeks in your filtered pool.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-fg-subtle grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px]">
                2
              </span>
              <span>
                At least 8 independent sources reference it, from the search-provider allowlist.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-fg-subtle grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px]">
                3
              </span>
              <span>
                A quest lands in your training plan, scoped to the closest existing skill cluster.
              </span>
            </li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
