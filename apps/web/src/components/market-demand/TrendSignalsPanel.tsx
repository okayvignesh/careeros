'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { Sparkline } from './Sparkline';

/**
 * TODO(api): implement GET /api/market/trends
 * Expected shape matches TrendSignal[]. Fixture shown until endpoint lands.
 */

export interface TrendSignal {
  id: string;
  technology: string;
  category: string;
  mentions: number;
  sources: number;
  firstSeen: string;
  trajectory: 'rising' | 'steady' | 'declining';
  history: number[];
}

const FIXTURE: TrendSignal[] = [
  {
    id: 'qdrant',
    technology: 'Qdrant',
    category: 'Vector database',
    mentions: 142,
    sources: 18,
    firstSeen: 'Jul 2026',
    trajectory: 'rising',
    history: [4, 12, 22, 38, 61, 92, 142],
  },
  {
    id: 'temporal',
    technology: 'Temporal',
    category: 'Durable workflows',
    mentions: 118,
    sources: 22,
    firstSeen: 'Aug 2026',
    trajectory: 'rising',
    history: [8, 15, 24, 40, 62, 88, 118],
  },
  {
    id: 'bun',
    technology: 'Bun',
    category: 'JS runtime',
    mentions: 96,
    sources: 14,
    firstSeen: 'Mar 2026',
    trajectory: 'steady',
    history: [72, 78, 82, 88, 92, 94, 96],
  },
  {
    id: 'kafka',
    technology: 'Kafka',
    category: 'Event streaming',
    mentions: 210,
    sources: 44,
    firstSeen: 'Jan 2024',
    trajectory: 'steady',
    history: [204, 208, 206, 212, 210, 209, 210],
  },
  {
    id: 'nomad',
    technology: 'Nomad',
    category: 'Orchestration',
    mentions: 58,
    sources: 11,
    firstSeen: 'Feb 2024',
    trajectory: 'declining',
    history: [96, 88, 80, 74, 68, 63, 58],
  },
];

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
  const [rows, setRows] = useState<TrendSignal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<TrendSignal[]>('/me/market/trends').catch(
        () => FIXTURE,
      );
      setRows(res);
      if (res.length > 0 && res[0]) setSelectedId(res[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }

  if (rows === null) return <Loader size={64} label="Loading trend signals" />;

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
        <p className="text-[13.5px] text-fg-muted">
          No trend signals yet. Signals appear once the weekly market refresh runs
          against your job pool and news sources.
        </p>
      </div>
    );
  }

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
              <th className="px-4 py-2.5">Technology</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Mentions</th>
              <th className="px-4 py-2.5 text-right">Sources</th>
              <th className="px-4 py-2.5">Trajectory</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = r.id === selected.id;
              return (
                <tr
                  key={r.id}
                  data-testid="trend-signal-row"
                  onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer border-b border-[hsl(var(--border))] last:border-0 ${
                    active
                      ? 'bg-[hsl(var(--bg-elev-2))]'
                      : 'hover:bg-[hsl(var(--bg-hover))/0.5]'
                  }`}
                >
                  <td className="px-4 py-3 text-fg">{r.technology}</td>
                  <td className="px-4 py-3 text-fg-muted">{r.category}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
                    {r.mentions.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
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
              <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-faint">
                {selected.category}
              </div>
              <div className="text-[18px] font-semibold text-fg">{selected.technology}</div>
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
            <dd className="text-right font-mono tabular-nums text-fg">
              {selected.mentions.toLocaleString()}
            </dd>
            <dt className="text-fg-faint">Sources</dt>
            <dd className="text-right font-mono tabular-nums text-fg">{selected.sources}</dd>
            <dt className="text-fg-faint">First seen</dt>
            <dd className="text-right font-mono tabular-nums text-fg">{selected.firstSeen}</dd>
          </dl>
        </div>

        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-faint">
            How a signal becomes a quest
          </div>
          <ol className="mt-3 flex flex-col gap-3 text-[12.5px] text-fg-muted">
            <li className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px] text-fg-subtle">
                1
              </span>
              <span>
                Signal crosses the mentions floor for two consecutive weeks in your
                filtered pool.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px] text-fg-subtle">
                2
              </span>
              <span>
                At least 8 independent sources reference it, from the search-provider
                allowlist.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] font-mono text-[11px] text-fg-subtle">
                3
              </span>
              <span>
                A quest lands in your training plan, scoped to the closest existing
                skill cluster.
              </span>
            </li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
