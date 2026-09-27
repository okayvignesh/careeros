'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Code, FileText, GraduationCap, Hand, MessageSquare, TrendingUp } from 'lucide-react';
import { Eyebrow } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { SkillIcon, hasSkillIcon } from '@/lib/skill-icon';
import { Loader } from '@/components/Loader';

interface Detail {
  skill: {
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
  };
  evidence: Array<{
    id: string;
    kind: string;
    signal: string;
    weightHint: number | null;
    sourceRef: Record<string, unknown> | null;
    observedAt: string;
  }>;
  events: Array<{
    id: string;
    rule: string;
    reason: string;
    evidenceId: string | null;
    beforeJson: unknown;
    afterJson: unknown;
    timestamp: string;
  }>;
}

const KIND_ICON: Record<string, typeof Code> = {
  code: Code,
  assessment: GraduationCap,
  document: FileText,
  self: Hand,
  behavioral: MessageSquare,
  outcome: TrendingUp,
};

export function SkillDetail({ skillId }: { skillId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Detail>(`/me/skills/${skillId}`)
      .then(setD)
      .catch((e) => setErr((e as Error).message));
  }, [skillId]);

  if (err) {
    return (
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-10 py-12">
        <Link href="/skills" className="inline-flex items-center gap-2 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> Back to skills
        </Link>
        <div className="rounded-[var(--radius)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-4 py-3 text-[13px] text-[hsl(var(--danger))]">
          {err}
        </div>
      </main>
    );
  }

  if (!d) {
    return (
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-10 py-12">
        <Link href="/skills" className="inline-flex items-center gap-2 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> Back to skills
        </Link>
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] py-16">
          <Loader size={64} state="working" label="Loading skill detail" />
        </div>
      </main>
    );
  }

  const { skill, evidence, events } = d;

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <Link href="/skills" className="inline-flex items-center gap-2 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> Back to skills
      </Link>

      <header className="flex items-center gap-5">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] text-fg-subtle">
          {hasSkillIcon(skill.id) ? (
            <SkillIcon skillId={skill.id} size={36} tone="brand" title={skill.name} />
          ) : (
            <span className="text-[16px] font-semibold tabular-nums">
              {skill.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Eyebrow>{skill.cluster ?? 'skill'}</Eyebrow>
          <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.02em]">{skill.name}</h1>
          {skill.aliases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-subtle">
              aka
              {skill.aliases.map((a) => (
                <span key={a} className="rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* state summary */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Level" value={String(skill.level)} highlight />
        <Stat label="Proficiency" value={`${Math.round(skill.proficiency)}`} suffix="/ 100" />
        <Stat label="Confidence" value={skill.confidence.toFixed(2)} />
        <Stat
          label="Recency"
          value={skill.evidenceCount > 0 ? `${skill.recencyDays}d` : '–'}
          hint={skill.historicalDemonstrated ? 'demonstrated' : 'not demonstrated'}
        />
      </section>

      {/* evidence list */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-faint">
          Evidence · {evidence.length}
        </div>
        {evidence.length === 0 ? (
          <EmptyPanel>No evidence for this skill yet.</EmptyPanel>
        ) : (
          <ul className="flex flex-col divide-y divide-[hsl(var(--border))] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
            {evidence.map((e) => {
              const Icon = KIND_ICON[e.kind] ?? Code;
              const src = e.sourceRef;
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2.5 text-[13px] text-fg">
                    <Icon className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                    <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                      {e.kind}
                    </span>
                    <span className="text-fg-subtle">·</span>
                    <span className="text-[12px] text-fg-muted">{e.signal}</span>
                    {typeof src?.fullName === 'string' && (
                      <>
                        <span className="text-fg-subtle">·</span>
                        <span className="truncate text-[12px] font-mono text-fg-muted">
                          {src.fullName as string}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-[11px] tabular-nums text-fg-faint">
                    {new Date(e.observedAt).toLocaleDateString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* event log */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-faint">
          Reason log · {events.length}
        </div>
        {events.length === 0 ? (
          <EmptyPanel>No state changes yet. Aggregation runs after each sync.</EmptyPanel>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-start justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-mono text-fg-muted">{ev.rule}</span>
                  <span className="text-[12.5px] text-fg">{ev.reason}</span>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">
                  {new Date(ev.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  suffix,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? 'flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.08)] px-4 py-3'
          : 'flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3'
      }
    >
      <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </span>
      <span className="text-[24px] font-semibold leading-none tabular-nums">
        {value}
        {suffix && <span className="ml-1 text-[13px] font-normal text-fg-subtle">{suffix}</span>}
      </span>
      {hint && <span className="text-[11px] text-fg-subtle">{hint}</span>}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-6 text-center text-[13px] text-fg-subtle">
      {children}
    </div>
  );
}
