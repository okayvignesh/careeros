'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, Target, XCircle } from 'lucide-react';
import { cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { useApi } from '@/lib/use-api';
import { QUEST_KIND_LABEL, getPrereqs, listQuests, listSkills } from '@/lib/quests';

/**
 * Screen 29 quest detail. Real inputs only: the quest from `/me/quests`, the
 * prereq graph from `/me/quests/prereq/:skillId`, and the skill's current state
 * from `/me/skills`. Acceptance criteria and XP rewards live in the assessment
 * sandbox, so this screen links there rather than inventing them.
 */
export function QuestDetail({ skillId }: { skillId: string }) {
  const load = useCallback(async () => {
    const [quests, prereqs, skills] = await Promise.all([
      listQuests('quarter'),
      getPrereqs(skillId),
      listSkills(),
    ]);
    return {
      quest: quests.find((q) => q.skillId === skillId) ?? null,
      prereqs,
      skill: skills.find((s) => s.id === skillId) ?? null,
      nameById: new Map(skills.map((s) => [s.id, s.name])),
    };
  }, [skillId]);
  const { data, error } = useApi(load);

  if (error) {
    return (
      <div role="alert" className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (data === null) return <Loader size={64} label="Loading quest" />;

  const { quest, prereqs, skill, nameById } = data;
  const label = (id: string) => nameById.get(id) ?? id;

  return (
    <div className="flex flex-col gap-8" data-testid="quest-detail">
      <Link
        href="/quests"
        data-testid="quest-back"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} /> All quests
      </Link>

      <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[20px] font-medium text-fg">{label(skillId)}</h2>
          {quest && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em] text-accent">
              {QUEST_KIND_LABEL[quest.kind]}
            </span>
          )}
        </div>
        {quest ? (
          <>
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">{quest.reason}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-fg-faint">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> ~{quest.estimatedHours}h estimated
              </span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Target className="h-3.5 w-3.5" /> target {Math.round(quest.targetProficiency * 100)}%
              </span>
              <span className="font-mono tabular-nums">priority {Math.round(quest.priority * 100)}%</span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-muted">
            This skill is not in the current planned quest set, but you can still see its state and
            prerequisites below.
          </p>
        )}
        <div>
          <Link
            href={`/skills/${encodeURIComponent(skillId)}`}
            data-testid="quest-open-skill"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[12.5px] text-fg hover:border-accent/50 hover:text-accent"
          >
            Open skill detail
          </Link>
        </div>
      </section>

      {skill && (
        <section className="flex flex-col gap-3" data-testid="quest-skill-state">
          <h3 className="text-[15px] font-medium text-fg">Your current state</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Level" value={`${skill.level}/100`} />
            <Stat label="Proficiency" value={`${Math.round(skill.proficiency * 100)}%`} />
            <Stat label="Confidence" value={`${Math.round(skill.confidence * 100)}%`} />
            <Stat label="Evidence" value={`${skill.evidenceCount} · ${skill.recencyDays}d ago`} />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" data-testid="quest-prereqs">
        <h3 className="text-[15px] font-medium text-fg">Prerequisites</h3>
        {prereqs.immediatePrereqs.length === 0 ? (
          <p className="text-[12.5px] text-fg-faint">No prerequisites recorded for this skill.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {prereqs.immediatePrereqs.map((p) => {
              const unmet = prereqs.unmetPrereqs.includes(p);
              return (
                <li
                  key={p}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 text-[13px]"
                >
                  <span className="text-fg">{label(p)}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[11.5px] uppercase tracking-[0.1em]',
                      unmet ? 'text-warn' : 'text-success',
                    )}
                  >
                    {unmet ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {unmet ? 'Not met' : 'Met'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-fg-faint">{label}</span>
      <span className="font-mono text-[15px] text-fg tabular-nums">{value}</span>
    </div>
  );
}
