'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { Tip } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { SkillIcon, hasSkillIcon } from '@/lib/skill-icon';
import { Loader } from '@/components/Loader';

interface SkillRow {
  id: string;
  name: string;
  cluster: string | null;
  aliases: string[];
  level: number;
  proficiency: number;
  confidence: number;
  evidenceCount: number;
  recencyDays: number;
  historicalDemonstrated: boolean;
}

type Filter = 'all' | 'with-evidence' | 'empty';

const CLUSTER_ORDER = ['language', 'framework', 'tool', 'domain', 'practice', 'other'];

export function SkillTree() {
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    apiGet<SkillRow[]>('/me/skills')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'with-evidence' && r.evidenceCount === 0) return false;
      if (filter === 'empty' && r.evidenceCount > 0) return false;
      if (!needle) return true;
      if (r.name.toLowerCase().includes(needle)) return true;
      if (r.id.toLowerCase().includes(needle)) return true;
      return r.aliases.some((a) => a.toLowerCase().includes(needle));
    });
  }, [rows, q, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SkillRow[]>();
    for (const r of filtered ?? []) {
      const c = r.cluster ?? 'other';
      const arr = map.get(c) ?? [];
      arr.push(r);
      map.set(c, arr);
    }
    return [...map.entries()].sort(
      (a, b) => CLUSTER_ORDER.indexOf(a[0]) - CLUSTER_ORDER.indexOf(b[0]),
    );
  }, [filtered]);

  return (
    <div className="flex flex-col gap-5">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex flex-1 items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-2 text-[13px] text-fg-muted focus-within:border-[hsl(var(--accent)/0.7)]">
          <Search className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search skills or aliases"
            className="flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
        <div className="inline-flex rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-0.5 text-[12.5px]">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'with-evidence', label: 'With evidence' },
              { id: 'empty', label: 'Empty' },
            ] as Array<{ id: Filter; label: string }>
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                filter === f.id
                  ? 'rounded-[calc(var(--radius)-2px)] bg-[hsl(var(--bg-elev-2))] px-3 py-1 text-fg'
                  : 'rounded-[calc(var(--radius)-2px)] px-3 py-1 text-fg-muted transition-colors hover:text-fg'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* clusters */}
      {rows === null ? (
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <Loader label="Loading skill graph" />
        </div>
      ) : grouped.length === 0 ? (
        <EmptyPanel>No skills match.</EmptyPanel>
      ) : (
        grouped.map(([cluster, list]) => (
          <section key={cluster} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-faint">
              {cluster}
              <span className="tabular-nums text-fg-faint/70">· {list.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {list.map((s) => (
                <Tip
                  key={s.id}
                  label={
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-fg">{s.name}</span>
                      <span className="text-fg-muted">
                        {s.evidenceCount === 0
                          ? 'No evidence — connect GitHub or complete an assessment'
                          : s.proficiency > 0
                            ? `Lv ${s.level} · ${s.evidenceCount} rows · confidence ${s.confidence.toFixed(2)}`
                            : `${s.evidenceCount} presence rows · needs an assessment for proficiency`}
                      </span>
                    </div>
                  }
                  side="top"
                >
                <Link
                  href={`/skills/${s.id}`}
                  className="group flex items-center gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:border-[hsl(var(--border-active))]"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle">
                    {hasSkillIcon(s.id) ? (
                      <SkillIcon skillId={s.id} size={18} tone="brand" title={s.name} />
                    ) : (
                      <span className="text-[11px] font-medium tabular-nums">
                        {s.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[13.5px] font-medium text-fg">{s.name}</span>
                    {/* Only render the proficiency track when proficiency > 0. Presence-only
                        signals (GitHub mining) leave proficiency at 0 by design, so a 0%-filled
                        bar just adds visual noise. Assessments in P2 and sustained-application
                        evidence in slice 2b will start pushing this above zero. */}
                    {s.proficiency > 0 && (
                      <div className="h-1 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
                        <div
                          className="h-full bg-[hsl(var(--accent))] transition-[width] duration-500"
                          style={{ width: `${Math.min(100, s.proficiency)}%` }}
                        />
                      </div>
                    )}
                    <span className="text-[10.5px] tabular-nums text-fg-faint">
                      {s.evidenceCount === 0
                        ? 'No evidence yet'
                        : s.proficiency > 0
                          ? `Lv ${s.level} · ${s.evidenceCount} rows`
                          : `${s.evidenceCount} presence rows · needs assessment`}
                    </span>
                  </div>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 shrink-0 text-fg-faint transition-colors group-hover:text-fg"
                    strokeWidth={1.7}
                  />
                </Link>
                </Tip>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-8 text-center text-[13px] text-fg-subtle">
      {children}
    </div>
  );
}
