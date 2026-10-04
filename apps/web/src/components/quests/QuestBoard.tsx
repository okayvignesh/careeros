'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Clock, Target } from 'lucide-react';
import { cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { QUEST_KIND_LABEL, type Horizon, type Quest, listQuests, listSkills } from '@/lib/quests';

const HORIZONS: Horizon[] = ['week', 'month', 'quarter'];

const kindTone: Record<string, string> = {
  'unlock-prereq': 'border-[hsl(var(--border))] text-fg-subtle',
  'sharpen-existing': 'border-accent/40 bg-accent/10 text-accent',
  'reach-target': 'border-warn/35 bg-warn/10 text-warn',
};

/**
 * C-P2.6c quest plan. The ordered list comes from `/me/quests` (which applies
 * the prereq DAG + learning-priority ranking server-side); skill labels come
 * from the `/me/skills` catalogue.
 */
export function QuestBoard() {
  const [horizon, setHorizon] = useState<Horizon>('week');
  const load = useCallback(async () => {
    const [quests, skills] = await Promise.all([listQuests(horizon), listSkills()]);
    return { quests, skills };
  }, [horizon]);
  const { data, error } = useApi(load);

  if (error) return <UnavailableNotice feature="Quests" testId="quests-unavailable" />;

  const skills = data?.skills ?? [];
  const nameById = new Map(skills.map((s) => [s.id, s.name]));
  const quests: Quest[] = data?.quests ?? [];

  return (
    <div className="flex flex-col gap-5" data-testid="quest-board">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Quest horizon">
        {HORIZONS.map((h) => (
          <button
            key={h}
            type="button"
            role="tab"
            aria-selected={horizon === h}
            data-testid={`quests-horizon-${h}`}
            onClick={() => setHorizon(h)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-[12.5px] capitalize transition-colors',
              horizon === h
                ? 'border-[hsl(var(--border-active))] bg-[hsl(var(--bg-elev-2))] text-fg'
                : 'border-[hsl(var(--border))] text-fg-muted hover:text-fg',
            )}
          >
            {h}
          </button>
        ))}
      </div>

      {data === null ? (
        <Loader size={64} label="Planning quests" />
      ) : quests.length === 0 ? (
        <p
          data-testid="quests-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          No quests planned for this horizon yet. Quests appear once your skill state and target
          roles are established.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="quest-list">
          {quests.map((quest) => (
            <li key={quest.id} data-testid="quest-row">
              <Link
                href={`/quests/${encodeURIComponent(quest.skillId)}`}
                className="group flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4 transition-colors hover:border-[hsl(var(--border-active))]"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-fg">
                      {nameById.get(quest.skillId) ?? quest.skillId}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em]',
                        kindTone[quest.kind] ?? kindTone['unlock-prereq'],
                      )}
                    >
                      {QUEST_KIND_LABEL[quest.kind]}
                    </span>
                  </div>
                  <span className="text-[12.5px] text-fg-muted">{quest.reason}</span>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-fg-faint">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> ~{quest.estimatedHours}h
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Target className="h-3.5 w-3.5" /> target{' '}
                    {Math.round(quest.targetProficiency * 100)}%
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-fg-faint transition-colors group-hover:text-fg" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
