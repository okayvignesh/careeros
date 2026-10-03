'use client';

import { useCallback } from 'react';
import { Briefcase, GraduationCap, Sparkles, Trash2, Wrench } from 'lucide-react';
import { Button, Tip, cn } from '@careeros/ui';
import { apiDelete, apiGet, apiPatch } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { useApi } from '@/lib/use-api';

interface Fact {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

const KIND_ORDER = ['headline', 'location', 'employment', 'education', 'skill', 'project'];
const KIND_ICON: Record<string, typeof Wrench> = {
  employment: Briefcase,
  education: GraduationCap,
  skill: Wrench,
  project: Sparkles,
};

export function FactBase() {
  const load = useCallback(() => apiGet<Fact[]>('/me/facts'), []);
  const {
    data: facts,
    error: err,
    setData: setFacts,
    setError: setErr,
    refetch,
  } = useApi(load);

  async function toggle(f: Fact) {
    setFacts((prev) =>
      prev ? prev.map((x) => (x.id === f.id ? { ...x, verified: !f.verified } : x)) : prev,
    );
    try {
      await apiPatch<Fact>(`/me/facts/${f.id}`, { verified: !f.verified });
    } catch (e) {
      setErr((e as Error).message);
      void refetch();
    }
  }

  async function remove(f: Fact) {
    if (!confirm(`Remove this ${f.kind} fact? Cannot undo.`)) return;
    setFacts((prev) => (prev ? prev.filter((x) => x.id !== f.id) : prev));
    try {
      await apiDelete<null>(`/me/facts/${f.id}`);
    } catch (e) {
      setErr((e as Error).message);
      void refetch();
    }
  }

  if (facts === null) {
    return (
      <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
        <Loader label="Loading fact base" />
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-10 text-center text-[13px] text-fg-subtle">
        No facts committed yet. Finish the resume step in setup and this page fills up.
      </div>
    );
  }

  const grouped = new Map<string, Fact[]>();
  for (const f of facts) {
    const arr = grouped.get(f.kind) ?? [];
    arr.push(f);
    grouped.set(f.kind, arr);
  }

  return (
    <div className="flex flex-col gap-6">
      {err && (
        <div className="rounded-[var(--radius)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-3.5 py-2.5 text-[12.5px] text-[hsl(var(--danger))]">
          {err}
        </div>
      )}
      {[...grouped.entries()]
        .sort(([a], [b]) => (KIND_ORDER.indexOf(a) === -1 ? 99 : KIND_ORDER.indexOf(a)) - (KIND_ORDER.indexOf(b) === -1 ? 99 : KIND_ORDER.indexOf(b)))
        .map(([kind, list]) => {
          const Icon = KIND_ICON[kind] ?? Wrench;
          return (
            <section key={kind} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-faint">
                <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                {kind}
                <span className="tabular-nums text-fg-faint/70">· {list.length}</span>
              </div>
              <ul className="flex flex-col divide-y divide-[hsl(var(--border))] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
                {list.map((f) => (
                  <li
                    key={f.id}
                    className={cn(
                      'flex items-start justify-between gap-4 px-4 py-3 transition-opacity',
                      !f.verified && 'opacity-50',
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
                      <span className="truncate font-medium text-fg">{summarize(kind, f.content)}</span>
                      <span className="truncate text-[11.5px] text-fg-subtle">
                        {supplement(kind, f.content)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => toggle(f)}>
                        {f.verified ? 'Reject' : 'Accept'}
                      </Button>
                      <Tip label="Remove fact">
                        <button
                          onClick={() => remove(f)}
                          className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-[hsl(var(--danger))]"
                          aria-label="Delete fact"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                        </button>
                      </Tip>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function summarize(kind: string, c: Record<string, unknown>): string {
  if (kind === 'headline') return String(c.text ?? '');
  if (kind === 'location') return String(c.text ?? '');
  if (kind === 'employment') return `${c.title ?? ''} at ${c.company ?? ''}`;
  if (kind === 'education') return `${c.degree ?? ''} in ${c.field ?? ''}`;
  if (kind === 'skill') return String(c.name ?? '');
  if (kind === 'project') return String(c.name ?? '');
  return JSON.stringify(c);
}

function supplement(kind: string, c: Record<string, unknown>): string {
  if (kind === 'employment') return `${c.start ?? ''} to ${c.end ?? 'present'}`;
  if (kind === 'education') return `${c.school ?? ''}${c.year ? ` · ${c.year}` : ''}`;
  if (kind === 'skill') return c.evidence ? String(c.evidence) : '';
  if (kind === 'project') return String(c.description ?? '');
  return '';
}
