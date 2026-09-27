'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { Tip, cn } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { SkillIcon, hasSkillIcon } from '@/lib/skill-icon';
import { Loader } from '@/components/Loader';

interface Row {
  id: string;
  skillId: string;
  skillName: string;
  kind: string;
  signal: string;
  weightHint: number | null;
  sourceRef: Record<string, unknown> | null;
  observedAt: string;
}

interface Facets {
  kinds: string[];
  signals: string[];
}

const SINCE_WINDOWS = [
  { id: 0, label: 'All time' },
  { id: 7, label: '7d' },
  { id: 30, label: '30d' },
  { id: 90, label: '90d' },
  { id: 365, label: '1y' },
];

export function EvidenceExplorer() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [kind, setKind] = useState<string>('');
  const [signal, setSignal] = useState<string>('');
  const [sinceDays, setSinceDays] = useState<number>(0);

  useEffect(() => {
    apiGet<Facets>('/me/evidence/facets')
      .then(setFacets)
      .catch(() => setFacets({ kinds: [], signals: [] }));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (signal) params.set('signal', signal);
    if (sinceDays) params.set('sinceDays', String(sinceDays));
    params.set('limit', '200');
    apiGet<Row[]>(`/me/evidence?${params.toString()}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [kind, signal, sinceDays]);

  const totalCost = useMemo(() => (rows ? rows.length : 0), [rows]);

  // Collapse multiple evidence rows for the same (skill, kind, signal) into one line,
  // then present each source as a pill. Same-day sync of 40 repos in JS = one row with
  // 40 pills (first 2 shown + "+38"). Different kinds/signals still get their own rows.
  const grouped = useMemo(() => groupRows(rows ?? []), [rows]);

  return (
    <div className="flex flex-col gap-5">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label="Kind"
          value={kind}
          options={facets?.kinds ?? []}
          onChange={setKind}
        />
        <FilterPill
          label="Signal"
          value={signal}
          options={facets?.signals ?? []}
          onChange={setSignal}
        />
        <div className="inline-flex rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-0.5 text-[12.5px]">
          {SINCE_WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => setSinceDays(w.id)}
              className={cn(
                'rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors',
                sinceDays === w.id
                  ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11.5px] tabular-nums text-fg-faint">
          {totalCost} rows
        </span>
      </div>

      {/* table */}
      {rows === null ? (
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <Loader label="Loading evidence" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyPanel>
          No evidence matches these filters. Try widening the window or clearing filters.
        </EmptyPanel>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[hsl(var(--bg-elev-1))] text-[10.5px] uppercase tracking-[0.1em] text-fg-faint">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Skill</th>
                <th className="px-4 py-2 text-left font-medium">Kind</th>
                <th className="px-4 py-2 text-left font-medium">Signal</th>
                <th className="px-4 py-2 text-left font-medium">Sources</th>
                <th className="px-4 py-2 text-right font-medium">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {grouped.map((g) => (
                <tr key={g.key} className="tabular-nums">
                  <td className="px-4 py-2">
                    <Link
                      href={`/skills/${g.skillId}`}
                      className="inline-flex items-center gap-2 text-fg hover:text-[hsl(var(--accent))]"
                    >
                      {hasSkillIcon(g.skillId) ? (
                        <SkillIcon skillId={g.skillId} size={14} tone="brand" title={g.skillName} />
                      ) : null}
                      {g.skillName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{g.kind}</td>
                  <td className="px-4 py-2 text-fg-muted">{g.signal}</td>
                  <td className="px-4 py-2">
                    <SourcePills sources={g.sources} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-fg-faint">
                    {new Date(g.latestAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- grouping + pills ---

interface Group {
  key: string;
  skillId: string;
  skillName: string;
  kind: string;
  signal: string;
  sources: Array<{ label: string; kind: string | null }>;
  latestAt: string;
}

const PILL_LIMIT = 2;

function groupRows(rows: Row[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.skillId}|${r.kind}|${r.signal}`;
    const src = sourceEntry(r.sourceRef);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        skillId: r.skillId,
        skillName: r.skillName,
        kind: r.kind,
        signal: r.signal,
        sources: [],
        latestAt: r.observedAt,
      };
      map.set(key, g);
    }
    if (src && !g.sources.some((s) => s.label === src.label)) {
      g.sources.push(src);
    }
    if (r.observedAt > g.latestAt) g.latestAt = r.observedAt;
  }
  return [...map.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}

function sourceEntry(src: Record<string, unknown> | null): { label: string; kind: string | null } | null {
  if (!src) return null;
  if (typeof src.fullName === 'string') return { label: src.fullName, kind: (src.kind as string) ?? null };
  if (typeof src.kind === 'string') return { label: src.kind, kind: src.kind };
  return null;
}

function SourcePills({ sources }: { sources: Group['sources'] }) {
  if (sources.length === 0) return <span className="text-fg-faint">–</span>;
  const visible = sources.slice(0, PILL_LIMIT);
  const overflow = sources.length - visible.length;
  const overflowList = sources.slice(PILL_LIMIT);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((s) => (
        <Tip key={s.label} label={s.label}>
          <span className="max-w-[220px] truncate rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
            {s.label}
          </span>
        </Tip>
      ))}
      {overflow > 0 && (
        <Tip
          label={
            <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
              {overflowList.map((s) => (
                <li key={s.label} className="truncate">{s.label}</li>
              ))}
            </ul>
          }
        >
          <span className="cursor-default rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-2))] px-1.5 py-0.5 text-[11px] text-fg-muted">
            +{overflow}
          </span>
        </Tip>
      )}
    </div>
  );
}

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 text-[12.5px] text-fg-muted">
      <span className="text-[11px] uppercase tracking-[0.1em] text-fg-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-fg outline-none"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-10 text-[13px] text-fg-subtle">
      <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
      {children}
    </div>
  );
}
