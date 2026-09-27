'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { Tip } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { SkillIcon, hasSkillIcon } from '@/lib/skill-icon';
import { Loader } from '@/components/Loader';

interface FocusSkill {
  skillId: string;
  name: string;
  cluster: string | null;
  level: number;
  proficiency: number;
  confidence: number;
  evidenceCount: number;
  recencyDays: number;
}

export function TopSkills() {
  const [rows, setRows] = useState<FocusSkill[] | null>(null);

  useEffect(() => {
    apiGet<FocusSkill[]>('/me/stats/top-skills')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <div className="flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} /> Top skills
      </div>
      {rows === null ? (
        <Loader label="Loading skills" />
      ) : rows.length === 0 ? (
        <EmptyPanel>
          Skill rows fill in as evidence lands. Sync GitHub or upload a resume to seed the graph.
        </EmptyPanel>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {rows.map((s) => (
            <Tip
              key={s.skillId}
              label={
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">{s.name}</span>
                  <span className="text-fg-muted">
                    Lv {s.level} · {s.evidenceCount} rows
                  </span>
                </div>
              }
            >
              <Link
                href={`/skills/${s.skillId}`}
                className="group relative grid aspect-square place-items-center rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle transition-colors duration-[var(--dur-fast)] hover:border-[hsl(var(--border-active))]"
              >
                {hasSkillIcon(s.skillId) ? (
                  <SkillIcon skillId={s.skillId} size={24} tone="brand" title={s.name} />
                ) : (
                  <span className="text-[12px] font-semibold tabular-nums text-fg-muted">
                    {s.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                {s.level > 1 && (
                  <span className="absolute bottom-1 right-1 rounded-md bg-[hsl(var(--accent))/0.85] px-1 text-[9px] font-semibold tabular-nums text-[hsl(var(--accent-fg))] leading-[14px]">
                    {s.level}
                  </span>
                )}
              </Link>
            </Tip>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[12.5px] text-fg-subtle">
      {children}
    </div>
  );
}
