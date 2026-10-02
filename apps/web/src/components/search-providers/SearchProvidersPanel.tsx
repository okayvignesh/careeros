'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { quotaShare, quotaTone } from './quota-tone';

/**
 * TODO(api): implement GET /api/search-providers (and .../workloads)
 * Expected shape matches SearchProvider[] / ProviderWorkload[]. Until the
 * endpoints land the panel renders an explicit unavailable state — never a
 * fixture.
 */

export type ProviderStatus = 'active' | 'standby' | 'error';

export interface SearchProvider {
  id: string;
  name: string;
  host: string;
  status: ProviderStatus;
  addedAt: string;
  usage: string;
  quota: number;
  used: number;
  authNote: string;
}

export interface ProviderWorkload {
  workload: string;
  provider: string;
  schedule: string;
}

const statusClass: Record<ProviderStatus, string> = {
  active:
    'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
  standby: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle',
  error:
    'border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.10)] text-[hsl(var(--danger))]',
};

const barToneClass = {
  default: 'bg-[hsl(var(--accent))]',
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
} as const;

export function SearchProvidersPanel() {
  const [providers, setProviders] = useState<SearchProvider[] | null>(null);
  const [workloads, setWorkloads] = useState<ProviderWorkload[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Endpoints missing (see TODO above): a failure must not resolve to
      // data, so the panel can render an honest unavailable state.
      const [p, w] = await Promise.all([
        apiGet<SearchProvider[]>('/me/search-providers'),
        apiGet<ProviderWorkload[]>('/me/search-providers/workloads'),
      ]);
      setProviders(p);
      setWorkloads(w);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <UnavailableNotice feature="Search providers" />;
  }

  if (providers === null) return <Loader size={64} label="Loading providers" />;

  return (
    <div className="flex flex-col gap-8">
      {providers.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
          <p className="text-[13.5px] text-fg-muted">
            No search providers configured yet. Add one to power market refresh,
            company dossiers, and technology signals.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {providers.map((p) => {
            const share = quotaShare(p.used, p.quota);
            const tone = quotaTone(p.used, p.quota);
            return (
              <li
                key={p.id}
                data-testid="provider-card"
                className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[15px] font-medium text-fg">{p.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] ${statusClass[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <span className="font-mono text-[11.5px] tabular-nums text-fg-faint">
                    {p.host}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-fg-muted">{p.usage}</p>
                <p className="mt-0.5 text-[11.5px] text-fg-faint">
                  {p.authNote} · added {p.addedAt}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
                    <div
                      className={`h-full transition-[width] duration-500 ${barToneClass[tone]}`}
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11.5px] tabular-nums text-fg-subtle">
                    {p.used.toLocaleString()} / {p.quota.toLocaleString()} monthly
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-faint">
          Workloads
        </h2>
        {workloads.length === 0 ? (
          <p className="text-[12.5px] text-fg-faint">No workloads scheduled yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
                  <th className="px-4 py-2.5">Workload</th>
                  <th className="px-4 py-2.5">Provider</th>
                  <th className="px-4 py-2.5 text-right">Schedule</th>
                </tr>
              </thead>
              <tbody>
                {workloads.map((w) => (
                  <tr
                    key={w.workload}
                    className="border-b border-[hsl(var(--border))] last:border-0"
                  >
                    <td className="px-4 py-3 text-fg">{w.workload}</td>
                    <td className="px-4 py-3 text-fg-muted">{w.provider}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-fg-muted">
                      {w.schedule}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
