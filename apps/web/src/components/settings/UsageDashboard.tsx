'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CircleDollarSign, PauseCircle, PlayCircle, Zap } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

type Window = '7d' | '30d' | '90d' | 'mtd';
type BreakdownKey = 'model' | 'provider' | 'callKind';

interface Summary {
  window: Window;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  errors: number;
  avgLatencyMs: number;
  deltaVsPrevious: { calls: number; costUsd: number };
}

interface BreakdownRow {
  key: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  pctOfTotal: number;
}

interface TimeseriesPoint {
  bucket: string;
  calls: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
}

interface CallRow {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  callKind: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
}

interface Budget {
  monthlyLimitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  resetsAt: string;
  overLimit: boolean;
}

const WINDOWS: Array<{ id: Window; label: string }> = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'mtd', label: 'MTD' },
];

const BREAKDOWNS: Array<{ id: BreakdownKey; label: string }> = [
  { id: 'model', label: 'By model' },
  { id: 'provider', label: 'By provider' },
  { id: 'callKind', label: 'By kind' },
];

export function UsageDashboard() {
  const [window, setWindow] = useState<Window>('30d');
  const [breakdownKey, setBreakdownKey] = useState<BreakdownKey>('model');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownRow[] | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[] | null>(null);
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [paused, setPaused] = useState<boolean>(false);

  const [errorsOnly, setErrorsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [s, b, t, c, bg, ps] = await Promise.all([
        apiGet<Summary>(`/me/usage/summary?window=${window}`),
        apiGet<BreakdownRow[]>(`/me/usage/breakdown?by=${breakdownKey}&window=${window}`),
        apiGet<TimeseriesPoint[]>(`/me/usage/timeseries?window=${window}&bucket=day`),
        apiGet<CallRow[]>(`/me/usage/calls?limit=100${errorsOnly ? '&errorsOnly=1' : ''}`),
        apiGet<Budget>('/me/usage/budget'),
        apiGet<{ paused: boolean }>('/me/usage/pause'),
      ]);
      setSummary(s);
      setBreakdown(b);
      setSeries(t);
      setCalls(c);
      setBudget(bg);
      setPaused(ps.paused);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
    // errorsOnly is intentionally excluded; toggling it re-fetches only calls (see effect below).

  }, [window, breakdownKey]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Cheap partial reload when errorsOnly toggles — no need to re-hit summary/timeseries/etc.
  useEffect(() => {
    apiGet<CallRow[]>(`/me/usage/calls?limit=100${errorsOnly ? '&errorsOnly=1' : ''}`)
      .then(setCalls)
      .catch((e) => setErr((e as Error).message));
  }, [errorsOnly]);

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    try {
      await apiPost('/me/usage/pause', { paused: next });
    } catch (e) {
      setPaused(!next);
      setErr((e as Error).message);
    }
  }

  async function saveBudget(value: number | null) {
    try {
      await apiPost('/me/usage/budget', { monthlyLimitUsd: value });
      const bg = await apiGet<Budget>('/me/usage/budget');
      setBudget(bg);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* window switcher + pause + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-0.5 text-[12.5px]">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => setWindow(w.id)}
              className={cn(
                'rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors duration-[var(--dur-fast)]',
                window === w.id
                  ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadAll} disabled={busy}>
            {busy ? <ThinkingOrb state="working" size={20} /> : null}
            Refresh
          </Button>
          <Button
            variant={paused ? 'primary' : 'secondary'}
            size="sm"
            onClick={togglePause}
          >
            {paused ? (
              <>
                <PlayCircle className="h-4 w-4" strokeWidth={1.7} /> Resume LLM calls
              </>
            ) : (
              <>
                <PauseCircle className="h-4 w-4" strokeWidth={1.7} /> Pause LLM calls
              </>
            )}
          </Button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-3.5 py-2.5 text-[12.5px] text-[hsl(var(--danger))]">
          <AlertCircle className="h-4 w-4" strokeWidth={1.8} />
          {err}
        </div>
      )}

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <KpiCard
          label="Cost"
          value={formatUsd(summary?.costUsd)}
          delta={summary?.deltaVsPrevious.costUsd}
          deltaFormat={(n) => `${n >= 0 ? '+' : ''}${formatUsd(n)}`}
        />
        <KpiCard
          label="Calls"
          value={formatNumber(summary?.calls)}
          delta={summary?.deltaVsPrevious.calls}
          deltaFormat={(n) => `${n >= 0 ? '+' : ''}${formatNumber(n)}`}
        />
        <KpiCard label="Input tokens" value={formatNumber(summary?.promptTokens)} />
        <KpiCard label="Output tokens" value={formatNumber(summary?.completionTokens)} />
      </section>

      {/* Budget bar */}
      <BudgetPanel budget={budget} onSave={saveBudget} />

      {/* Timeseries */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
          <Zap className="h-3.5 w-3.5" strokeWidth={1.7} /> Daily spend
        </div>
        <Timeseries points={series} />
      </section>

      {/* Breakdown tabs */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-0.5 text-[12.5px]">
            {BREAKDOWNS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBreakdownKey(b.id)}
                className={cn(
                  'rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors duration-[var(--dur-fast)]',
                  breakdownKey === b.id
                    ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <BreakdownTable rows={breakdown} />
      </section>

      {/* Recent calls */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
            Recent calls
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg-muted">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] text-[hsl(var(--accent))]"
            />
            Errors only
          </label>
        </div>
        <CallsTable rows={calls} />
      </section>
    </div>
  );
}

// ---------- widgets ----------

function KpiCard({
  label,
  value,
  delta,
  deltaFormat,
}: {
  label: string;
  value: string;
  delta?: number | undefined;
  deltaFormat?: ((n: number) => string) | undefined;
}) {
  const showDelta = typeof delta === 'number' && deltaFormat !== undefined;
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-faint">{label}</div>
      <div className="text-[26px] font-semibold leading-none tabular-nums">{value}</div>
      {showDelta ? (
        <div
          className={cn(
            'text-[11.5px] tabular-nums',
            positive ? 'text-[hsl(var(--success))]' : 'text-[hsl(var(--danger))]',
          )}
        >
          {deltaFormat!(delta as number)} vs prev window
        </div>
      ) : null}
    </div>
  );
}

function BudgetPanel({
  budget,
  onSave,
}: {
  budget: Budget | null;
  onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [inputErr, setInputErr] = useState<string | null>(null);

  function submit() {
    setInputErr(null);
    const trimmed = draft.trim();
    if (trimmed === '') {
      onSave(null);
      setEditing(false);
      return;
    }
    const v = Number(trimmed);
    if (!Number.isFinite(v) || v < 0) {
      setInputErr('Enter a non-negative number, or leave blank to clear.');
      return;
    }
    onSave(v);
    setEditing(false);
  }

  const pct = useMemo(() => {
    if (!budget?.monthlyLimitUsd) return 0;
    return Math.min(100, (budget.spentUsd / budget.monthlyLimitUsd) * 100);
  }, [budget]);
  const barColor =
    pct < 60 ? 'hsl(var(--success))' : pct < 90 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
          <CircleDollarSign className="h-3.5 w-3.5" strokeWidth={1.7} /> Monthly budget
        </div>
        {!editing ? (
          <button
            onClick={() => {
              // Seed the draft from the loaded budget when entering edit mode.
              setDraft(budget?.monthlyLimitUsd?.toString() ?? '');
              setEditing(true);
            }}
            className="text-[12px] text-fg-muted transition-colors hover:text-fg"
          >
            {budget?.monthlyLimitUsd == null ? 'Set limit' : 'Edit'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              step="0.5"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (inputErr) setInputErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder="20.00"
              autoFocus
              className="w-24 rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-2 py-1 text-right text-[12.5px] tabular-nums focus-visible:outline-none focus-visible:border-[hsl(var(--accent)/0.7)]"
            />
            <Button size="sm" variant="ghost" onClick={submit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setInputErr(null); }}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {inputErr && (
        <div className="text-[12px] text-[hsl(var(--danger))]">{inputErr}</div>
      )}
      {budget && (
        <>
          <div className="flex items-baseline justify-between text-[13px] tabular-nums">
            <span className="text-fg">
              <span className="font-semibold">{formatUsd(budget.spentUsd)}</span>
              <span className="text-fg-subtle">
                {' '}
                spent
                {budget.monthlyLimitUsd != null ? ` of ${formatUsd(budget.monthlyLimitUsd)}` : ''}
              </span>
            </span>
            <span className="text-[11.5px] text-fg-faint">
              Resets {new Date(budget.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
          {budget.monthlyLimitUsd != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
              <div
                className="h-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
          )}
          {budget.overLimit && (
            <div className="text-[12px] text-[hsl(var(--danger))]">
              Over limit. New LLM calls will fail until you raise the budget or reset the month.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Timeseries({ points }: { points: TimeseriesPoint[] | null }) {
  if (!points) {
    return <div className="h-24 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]" />;
  }
  if (points.length === 0) {
    return (
      <EmptyPanel>No calls in this window yet. Trigger a provider probe or a resume parse.</EmptyPanel>
    );
  }
  const max = Math.max(...points.map((p) => p.costUsd), 0.001);
  return (
    <div className="flex h-32 items-end gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-3 py-3">
      {points.map((p) => {
        const height = Math.max(2, (p.costUsd / max) * 100);
        return (
          <div key={p.bucket} className="group relative flex-1">
            <div
              className="w-full rounded-sm bg-[hsl(var(--accent)/0.55)] transition-colors duration-[var(--dur-fast)] group-hover:bg-[hsl(var(--accent))]"
              style={{ height: `${height}%` }}
              title={`${new Date(p.bucket).toLocaleDateString()} · ${formatUsd(p.costUsd)} · ${p.calls} calls`}
            />
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] | null }) {
  if (!rows) return <SkeletonRows n={3} />;
  if (rows.length === 0) return <EmptyPanel>No data yet.</EmptyPanel>;
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
      <table className="w-full text-[12.5px]">
        <thead className="bg-[hsl(var(--bg-elev-1))] text-[10.5px] uppercase tracking-[0.1em] text-fg-faint">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-right font-medium">Calls</th>
            <th className="px-4 py-2 text-right font-medium">In</th>
            <th className="px-4 py-2 text-right font-medium">Out</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">
          {rows.map((r) => (
            <tr key={r.key} className="tabular-nums">
              <td className="px-4 py-2 font-mono text-[12px] text-fg">{r.key}</td>
              <td className="px-4 py-2 text-right text-fg">{formatNumber(r.calls)}</td>
              <td className="px-4 py-2 text-right text-fg-muted">{formatNumber(r.promptTokens)}</td>
              <td className="px-4 py-2 text-right text-fg-muted">{formatNumber(r.completionTokens)}</td>
              <td className="px-4 py-2 text-right font-medium text-fg">{formatUsd(r.costUsd)}</td>
              <td className="px-4 py-2 text-right text-fg-subtle">{r.pctOfTotal.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallsTable({ rows }: { rows: CallRow[] | null }) {
  if (!rows) return <SkeletonRows n={5} />;
  if (rows.length === 0) return <EmptyPanel>No LLM calls yet. Your first call will appear here.</EmptyPanel>;
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
      <table className="w-full text-[12px]">
        <thead className="bg-[hsl(var(--bg-elev-1))] text-[10.5px] uppercase tracking-[0.1em] text-fg-faint">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Time</th>
            <th className="px-4 py-2 text-left font-medium">Model</th>
            <th className="px-4 py-2 text-left font-medium">Kind</th>
            <th className="px-4 py-2 text-right font-medium">Tokens</th>
            <th className="px-4 py-2 text-right font-medium">Latency</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">
          {rows.map((r) => (
            <tr key={r.id} className="tabular-nums">
              <td className="whitespace-nowrap px-4 py-1.5 text-fg-muted">
                {new Date(r.timestamp).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td className="px-4 py-1.5 font-mono text-fg">{r.model}</td>
              <td className="px-4 py-1.5 text-fg-muted">{r.callKind}</td>
              <td className="px-4 py-1.5 text-right text-fg-muted">
                {r.promptTokens != null || r.completionTokens != null
                  ? `${formatNumber(r.promptTokens ?? 0)} / ${formatNumber(r.completionTokens ?? 0)}`
                  : '–'}
              </td>
              <td className="px-4 py-1.5 text-right text-fg-muted">{r.latencyMs}ms</td>
              <td className="px-4 py-1.5 text-right font-medium text-fg">
                {r.costUsd == null ? '–' : formatUsd(r.costUsd)}
              </td>
              <td className="px-4 py-1.5">
                {r.ok ? (
                  <span className="text-[hsl(var(--success))]">OK</span>
                ) : (
                  <span title={r.error ?? undefined} className="text-[hsl(var(--danger))]">
                    Failed
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]"
        />
      ))}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[12.5px] text-fg-subtle">
      {children}
    </div>
  );
}

// ---------- formatters ----------

function formatUsd(n: number | undefined | null): string {
  if (n == null) return '$0.00';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
