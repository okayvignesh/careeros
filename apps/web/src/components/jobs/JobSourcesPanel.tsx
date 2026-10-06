'use client';

import { useCallback } from 'react';
import { AlertTriangle, Rss } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { listJobs } from '@/lib/jobs';

interface JobAdapter {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  licenseHint: string;
  attribution: string;
}

interface SearchProviderSummary {
  id: string;
  name: string;
  host: string;
  status: 'active' | 'standby' | 'error';
  addedAt: string | null;
  usage: string;
  authNote: string;
}

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 · Employer and ATS',
  2: 'Tier 2 · Authorised platform feeds',
  3: 'Tier 3-4 · Aggregators and web discovery',
};

const statusTone: Record<string, string> = {
  active: 'border-success/35 bg-success/10 text-success',
  standby: 'border-[hsl(var(--border))] text-fg-subtle',
  error: 'border-danger/35 bg-danger/10 text-danger',
};

/**
 * Screen 55 job sources. Composition comes from the live adapter registry
 * (`/admin/jobs/adapters`) and its config-derived state from
 * `/me/search-providers`; posting counts are the real `/jobs` pool grouped by
 * primary source.
 */
export function JobSourcesPanel() {
  const load = useCallback(async () => {
    const [adapters, providers, jobs] = await Promise.all([
      apiGet<JobAdapter[]>('/admin/jobs/adapters'),
      apiGet<{ providers: SearchProviderSummary[] }>('/me/search-providers'),
      listJobs(200, 0),
    ]);
    return { adapters, providers: providers.providers, jobs: jobs.jobs };
  }, []);
  const { data, error } = useApi(load);

  if (error) return <UnavailableNotice feature="Job sources" testId="job-sources-unavailable" />;
  if (data === null) return <Loader size={64} label="Loading job sources" />;

  const providerById = new Map(data.providers.map((p) => [p.id, p]));
  const postingsBySource = new Map<string, number>();
  for (const job of data.jobs) {
    postingsBySource.set(job.primarySource, (postingsBySource.get(job.primarySource) ?? 0) + 1);
  }

  const tiers = [1, 2, 3] as const;

  return (
    <div className="flex flex-col gap-8" data-testid="job-sources-panel">
      <p className="flex items-start gap-2 text-[12.5px] text-fg-muted">
        <Rss className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
        A tiered model: employer and ATS first, authorised platform feeds second, permitted
        aggregators third, web discovery last. Trust follows the tier.
      </p>

      {tiers.map((tier) => {
        const rows = data.adapters.filter((a) => a.tier === tier);
        return (
          <section key={tier} className="flex flex-col gap-3" data-testid={`job-sources-tier-${tier}`}>
            <h2 className="text-[15px] font-medium text-fg">{TIER_LABEL[tier]}</h2>
            {rows.length === 0 ? (
              <p className="text-[12.5px] text-fg-faint">No adapters registered in this tier.</p>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
                <table className="w-full text-[13px]">
                  <thead className="bg-[hsl(var(--bg-elev-1))] text-left text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Source</th>
                      <th className="px-4 py-2.5 font-medium">Access</th>
                      <th className="px-4 py-2.5 font-medium">Rate limit</th>
                      <th className="px-4 py-2.5 text-right font-medium">Postings</th>
                      <th className="px-4 py-2.5 font-medium">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((adapter) => {
                      const provider = providerById.get(adapter.id);
                      const status = provider?.status ?? 'standby';
                      return (
                        <tr
                          key={adapter.id}
                          data-testid="job-source-row"
                          className="border-t border-[hsl(var(--border))]"
                        >
                          <td className="px-4 py-3 text-fg">
                            {adapter.name}
                            <span className="ml-2 font-mono text-[11px] text-fg-faint">{adapter.id}</span>
                          </td>
                          <td className="px-4 py-3 text-fg-muted">{adapter.licenseHint}</td>
                          <td className="px-4 py-3 text-fg-muted">{provider?.usage ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-fg-muted tabular-nums">
                            {postingsBySource.get(adapter.id) ?? 0}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em] ${statusTone[status] ?? statusTone.standby}`}
                            >
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <div className="flex items-start gap-2 rounded-[var(--radius)] border border-warn/30 bg-warn/10 px-4 py-3 text-[12.5px] text-warn">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          LinkedIn, Indeed and Naukri are never server-scraped. Their adapters stay dark until
          partner access is provisioned; discovery uses permitted sources only.
        </span>
      </div>
    </div>
  );
}
