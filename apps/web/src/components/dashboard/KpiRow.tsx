'use client';

import { useEffect, useState } from 'react';
import { Activity, Database, GitBranch, ShieldCheck } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Tip } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';

interface Kpis {
  skillsTracked: number;
  skillsCatalog: number;
  evidenceRows: number;
  reposAnalyzed: number;
  factsVerified: number;
  factsTotal: number;
}

export function KpiRow() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Kpis>('/me/stats/dashboard')
      .then(setKpis)
      .catch((e) => setErr((e as Error).message));
  }, []);

  const skillsPct =
    kpis && kpis.skillsCatalog > 0
      ? Math.min(100, Math.round((kpis.skillsTracked / kpis.skillsCatalog) * 100))
      : 0;
  const factsPct =
    kpis && kpis.factsTotal > 0
      ? Math.min(100, Math.round((kpis.factsVerified / kpis.factsTotal) * 100))
      : 0;

  return (
    <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <KpiCard
        icon={Database}
        label="Skills tracked"
        loading={kpis === null}
        value={kpis ? formatNumber(kpis.skillsTracked) : null}
        detail={kpis ? `of ${kpis.skillsCatalog} in graph` : null}
        progress={kpis ? skillsPct : undefined}
        help="Skills with at least one evidence row. Denominator = seeded catalog."
        error={err}
      />
      <KpiCard
        icon={Activity}
        label="Evidence rows"
        loading={kpis === null}
        value={kpis ? formatNumber(kpis.evidenceRows) : null}
        detail={kpis ? 'immutable, append-only' : null}
        help="Every proof the graph has absorbed."
        error={err}
      />
      <KpiCard
        icon={GitBranch}
        label="Repos analyzed"
        loading={kpis === null}
        value={kpis ? formatNumber(kpis.reposAnalyzed) : null}
        detail={
          kpis ? (kpis.reposAnalyzed === 1 ? 'via GitHub sync' : `via GitHub sync`) : null
        }
        help="Distinct GitHub repos contributing evidence."
        error={err}
      />
      <KpiCard
        icon={ShieldCheck}
        label="Facts verified"
        loading={kpis === null}
        value={kpis ? formatNumber(kpis.factsVerified) : null}
        detail={
          kpis
            ? kpis.factsTotal > 0
              ? `of ${kpis.factsTotal} on resume`
              : 'no facts committed yet'
            : null
        }
        progress={kpis && kpis.factsTotal > 0 ? factsPct : undefined}
        help="Resume facts marked verified in the fact base."
        error={err}
      />
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  progress,
  help,
  error,
  loading,
}: {
  icon: typeof Database;
  label: string;
  value: string | null;
  detail: string | null;
  progress?: number | undefined;
  help: string;
  error: string | null;
  loading: boolean;
}) {
  const hasValue = value !== null && value !== '0';
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-4">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </div>
        <Tip label={help}>
          <span className="cursor-default text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
            {label}
          </span>
        </Tip>
      </div>

      {loading ? (
        <div className="flex h-[52px] items-center">
          <ThinkingOrb state="working" size={20} />
        </div>
      ) : (
        <Tip label={error ?? ''}>
          <div className="flex cursor-default flex-col gap-1.5">
            <span
              className={
                hasValue
                  ? 'text-[32px] font-semibold leading-none tabular-nums text-fg'
                  : 'text-[32px] font-semibold leading-none tabular-nums text-fg-faint'
              }
            >
              {value}
            </span>
            {detail && (
              <span className="text-[11.5px] tabular-nums text-fg-subtle">{detail}</span>
            )}
            {typeof progress === 'number' && (
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
                <div
                  className="h-full bg-[hsl(var(--accent))] transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </Tip>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
