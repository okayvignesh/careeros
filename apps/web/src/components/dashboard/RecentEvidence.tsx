'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Code, FileText, GraduationCap, Hand, MessageSquare, TrendingUp } from 'lucide-react';
import { Tip } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { Loader } from '@/components/Loader';

interface Row {
  id: string;
  skillId: string;
  skillName: string;
  kind: string;
  signal: string;
  observedAt: string;
  sourceKind: string | null;
}

const KIND_ICON: Record<string, typeof Code> = {
  code: Code,
  assessment: GraduationCap,
  document: FileText,
  self: Hand,
  behavioral: MessageSquare,
  outcome: TrendingUp,
};

export function RecentEvidence() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    apiGet<Row[]>('/me/stats/recent-evidence')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <div className="flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        <Activity className="h-3.5 w-3.5" strokeWidth={1.7} /> Recent evidence
      </div>
      {rows === null ? (
        <Loader label="Loading evidence" />
      ) : rows.length === 0 ? (
        <EmptyPanel>
          No evidence yet. Connect GitHub in setup and press Resync above, or complete an assessment.
        </EmptyPanel>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))]">
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind] ?? Activity;
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Tip label={r.kind}>
                    <Icon className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                  </Tip>
                  <Link href={`/skills/${r.skillId}`} className="font-medium text-fg hover:text-[hsl(var(--accent))]">
                    {r.skillName}
                  </Link>
                  <span className="text-fg-subtle">·</span>
                  <span className="text-[12px] text-fg-muted">{r.signal}</span>
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-fg-faint tabular-nums">
                  {r.sourceKind && <span>{r.sourceKind}</span>}
                  <Tip label={new Date(r.observedAt).toLocaleString()}>
                    <span>{relative(r.observedAt)}</span>
                  </Tip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[12.5px] text-fg-subtle">
      {children}
    </div>
  );
}
