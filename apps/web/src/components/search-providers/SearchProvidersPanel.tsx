'use client';

import { useCallback, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Button } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { quotaShare, quotaTone } from './quota-tone';
import { providersView, workloadsView } from './providers-data';
import { ProviderConfigDialog } from './ProviderConfigDialog';
import type { SearchProvider } from '@careeros/shared';

/**
 * Screen 56: configured search providers.
 *
 * Backed by `GET /me/search-providers` + `/me/search-providers/workloads`. An
 * install with no configured source returns empty envelopes, which render as
 * empty states — `UnavailableNotice` is only for actual load/validation
 * failures (A8). Per-provider quota is not persisted yet, so the API returns
 * `quota`/`used` as null and the panel says "usage not tracked" rather than
 * drawing an invented bar.
 */

export type {
  SearchProviderStatus as ProviderStatus,
  SearchProvider,
  SearchProviderWorkload as ProviderWorkload,
} from '@careeros/shared';

const statusClass: Record<string, string> = {
  active:
    'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
  standby: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle',
  error: 'border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.10)] text-[hsl(var(--danger))]',
};

const barToneClass = {
  default: 'bg-[hsl(var(--accent))]',
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
} as const;

export function SearchProvidersPanel() {
  const load = useCallback(async () => {
    const [p, w] = await Promise.all([
      apiGet<unknown>('/me/search-providers'),
      apiGet<unknown>('/me/search-providers/workloads'),
    ]);
    return { providers: providersView(p), workloads: workloadsView(w) };
  }, []);
  const { data, error, setData } = useApi(load);
  const providers = data?.providers ?? null;
  const workloads = data?.workloads ?? [];
  const [editing, setEditing] = useState<SearchProvider | null>(null);

  function onSaved(updated: SearchProvider) {
    setData((prev) =>
      prev
        ? { ...prev, providers: prev.providers.map((p) => (p.id === updated.id ? updated : p)) }
        : prev,
    );
  }

  if (error) {
    return <UnavailableNotice feature="Search providers" />;
  }

  if (providers === null) return <Loader size={64} label="Loading providers" />;

  return (
    <div className="flex flex-col gap-8">
      {providers.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
          <p className="text-fg-muted text-[13.5px]">
            No search providers configured yet. Add one to power market refresh, company dossiers,
            and technology signals.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {providers.map((p) => {
            const quota = p.quota;
            const used = p.used;
            const share = quota !== null && used !== null ? quotaShare(used, quota) : 0;
            const tone = quota !== null && used !== null ? quotaTone(used, quota) : 'default';
            return (
              <li
                key={p.id}
                data-testid="provider-card"
                className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="text-fg text-[15px] font-medium">{p.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] ${statusClass[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-fg-faint font-mono text-[11.5px] tabular-nums">
                      {p.host}
                    </span>
                    {p.fields.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid={`provider-configure-${p.id}`}
                        onClick={() => setEditing(p)}
                      >
                        Configure
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-fg-muted mt-1 text-[12.5px]">{p.usage}</p>
                <p className="text-fg-faint mt-0.5 text-[11.5px]">
                  {p.authNote}
                  {p.addedAt ? ` · first seen ${p.addedAt}` : ''}
                </p>
                {p.missing.length > 0 && (
                  <p
                    data-testid={`provider-missing-${p.id}`}
                    className="text-warn mt-0.5 text-[11.5px]"
                  >
                    Missing: {p.missing.join(', ')}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  {quota !== null && used !== null ? (
                    <>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
                        <div
                          className={`h-full transition-[width] duration-500 ${barToneClass[tone]}`}
                          style={{ width: `${share * 100}%` }}
                        />
                      </div>
                      <span className="text-fg-subtle font-mono text-[11.5px] tabular-nums">
                        {used.toLocaleString()} / {quota.toLocaleString()} monthly
                      </span>
                    </>
                  ) : (
                    <span className="text-fg-faint font-mono text-[11.5px] tabular-nums">
                      usage not tracked
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ProviderConfigDialog
          provider={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-fg-faint text-[10.5px] font-medium uppercase tracking-[0.14em]">
          Workloads
        </h2>
        {workloads.length === 0 ? (
          <p className="text-fg-faint text-[12.5px]">No workloads scheduled yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-fg-faint border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em]">
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
                    <td className="text-fg px-4 py-3">{w.workload}</td>
                    <td className="text-fg-muted px-4 py-3">{w.provider}</td>
                    <td className="text-fg-muted px-4 py-3 text-right font-mono text-[12px] tabular-nums">
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
