'use client';

import { useCallback, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { Sparkline } from './Sparkline';
import { GapBadge } from './GapBadge';
import { skillDemandView, type SkillDemandView } from './market-data';

/**
 * Screen 33: Skill demand table.
 *
 * Backed by `GET /me/market/skill-demand?window=<days>` (derived from the
 * caller's persisted job pool). An empty result is a real empty state, not an
 * unavailable notice — the notice is reserved for actual load/validation
 * failures (A8: never a fixture).
 */

const WINDOW_DAYS = 30;

export type { SkillDemandRow } from '@careeros/shared';

export function SkillDemandTable() {
  const [cluster, setCluster] = useState('All');
  const [onlyGaps, setOnlyGaps] = useState(false);

  const load = useCallback(async () => {
    const res = await apiGet<unknown>(`/me/market/skill-demand?window=${WINDOW_DAYS}`);
    return skillDemandView(res);
  }, []);
  const { data, error } = useApi<SkillDemandView>(load);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (cluster !== 'All' && r.cluster !== cluster) return false;
      if (onlyGaps && r.gap <= 0) return false;
      return true;
    });
  }, [data, cluster, onlyGaps]);

  if (error) {
    return <UnavailableNotice feature="Skill demand" />;
  }

  if (data === null) {
    return <Loader size={64} label="Loading skill demand" />;
  }

  if (data.rows.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
        <p className="text-fg-muted text-[13.5px]">
          No skill demand yet. Sync jobs and extract skills, then demand will show up here for the
          last {data.windowDays} days.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-fg-muted flex items-center gap-1.5 text-[12px]">
          <span className="text-fg-faint uppercase tracking-[0.12em]">Cluster</span>
          <select
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
            className="text-fg rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2 py-1 text-[12px]"
          >
            {['All', ...data.clusters].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-fg-muted flex items-center gap-1.5 text-[12px]">
          <input
            type="checkbox"
            checked={onlyGaps}
            onChange={(e) => setOnlyGaps(e.target.checked)}
            className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
          />
          Only my gaps
        </label>
        <span className="text-fg-faint ml-auto font-mono text-[11.5px] tabular-nums">
          {filtered.length} of {data.rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
          <p className="text-fg-muted text-[13.5px]">
            No skills match this filter. Widen the cluster or clear the gap toggle.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-fg-faint border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em]">
                <th className="px-4 py-2.5">Skill</th>
                <th className="px-4 py-2.5 text-right">Postings</th>
                <th className="px-4 py-2.5 text-right">Share</th>
                <th className="px-4 py-2.5">Trend</th>
                <th className="px-4 py-2.5 text-right">Against threshold</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.skillId}
                  data-testid="skill-demand-row"
                  className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--bg-hover))/0.5]"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-fg">{r.label}</span>
                      <span className="text-fg-faint text-[11px]">{r.cluster}</span>
                    </div>
                  </td>
                  <td className="text-fg-muted px-4 py-3 text-right font-mono tabular-nums">
                    {r.postings.toLocaleString()}
                  </td>
                  <td className="text-fg-muted px-4 py-3 text-right font-mono tabular-nums">
                    {Math.round(r.share * 100)}%
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline
                      values={r.history}
                      ariaLabel={`${r.label} ${data.windowDays} window trend`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <GapBadge gap={r.gap} />
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
