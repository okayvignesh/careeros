'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';
import { Sparkline } from './Sparkline';
import { GapBadge } from './GapBadge';

/**
 * TODO(api): implement GET /api/market/skill-demand?window=<days>
 * Expected shape matches SkillDemandRow[]. Until the endpoint lands, the
 * component renders a fixture so screen 33 is visibly complete.
 */

export interface SkillDemandRow {
  skillId: string;
  label: string;
  cluster: string;
  postings: number;
  share: number;
  history: number[];
  gap: number;
}

const CLUSTERS = ['All', 'Backend', 'Cloud', 'Data', 'Frontend'] as const;

const FIXTURE: SkillDemandRow[] = [
  {
    skillId: 'typescript',
    label: 'TypeScript',
    cluster: 'Frontend',
    postings: 412,
    share: 0.34,
    history: [180, 210, 250, 280, 320, 360, 412],
    gap: 0,
  },
  {
    skillId: 'aws',
    label: 'AWS',
    cluster: 'Cloud',
    postings: 388,
    share: 0.32,
    history: [280, 300, 310, 320, 350, 370, 388],
    gap: 24,
  },
  {
    skillId: 'postgres',
    label: 'PostgreSQL',
    cluster: 'Data',
    postings: 302,
    share: 0.25,
    history: [200, 210, 220, 240, 260, 280, 302],
    gap: 27,
  },
  {
    skillId: 'kubernetes',
    label: 'Kubernetes',
    cluster: 'Cloud',
    postings: 264,
    share: 0.22,
    history: [180, 190, 210, 220, 230, 245, 264],
    gap: 13,
  },
  {
    skillId: 'terraform',
    label: 'Terraform',
    cluster: 'Cloud',
    postings: 198,
    share: 0.16,
    history: [80, 90, 110, 130, 150, 170, 198],
    gap: 38,
  },
];

export function SkillDemandTable() {
  const [rows, setRows] = useState<SkillDemandRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cluster, setCluster] = useState<(typeof CLUSTERS)[number]>('All');
  const [onlyGaps, setOnlyGaps] = useState(false);

  const load = useCallback(async () => {
    try {
      // ponytail: endpoint missing (see TODO above). Fall back to fixture so
      // the screen renders. Real fetch path stays wired for the day it ships.
      const res = await apiGet<SkillDemandRow[]>('/me/market/skill-demand').catch(
        () => FIXTURE,
      );
      setRows(res);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (cluster !== 'All' && r.cluster !== cluster) return false;
      if (onlyGaps && r.gap <= 0) return false;
      return true;
    });
  }, [rows, cluster, onlyGaps]);

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }

  if (rows === null) {
    return <Loader size={64} label="Loading skill demand" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <span className="uppercase tracking-[0.12em] text-fg-faint">Cluster</span>
          <select
            value={cluster}
            onChange={(e) => setCluster(e.target.value as (typeof CLUSTERS)[number])}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2 py-1 text-[12px] text-fg"
          >
            {CLUSTERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <input
            type="checkbox"
            checked={onlyGaps}
            onChange={(e) => setOnlyGaps(e.target.checked)}
            className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
          />
          Only my gaps
        </label>
        <span className="ml-auto font-mono text-[11.5px] tabular-nums text-fg-faint">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
          <p className="text-[13.5px] text-fg-muted">
            No skills match this filter. Widen the cluster or clear the gap toggle.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
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
                      <span className="text-[11px] text-fg-faint">{r.cluster}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
                    {r.postings.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
                    {Math.round(r.share * 100)}%
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline
                      values={r.history}
                      ariaLabel={`${r.label} 7 window trend`}
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
