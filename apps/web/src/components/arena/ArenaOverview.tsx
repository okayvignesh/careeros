'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Flame, Sparkles, Swords, Trophy, type LucideIcon } from 'lucide-react';
import { Button } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface LevelInfo {
  level: number;
  xpInLevel: number;
  xpToNext: number;
  totalXp: number;
}

interface Progression {
  totalXp: number;
  level: LevelInfo;
  streakDays: number;
  longestStreakDays: number;
  attemptsTotal: number;
  recentXp: Array<{ id: string; reason: string; xp: number; createdAt: string }>;
}

interface RemediationTask {
  id: string;
  skillId: string;
  reason: string;
  createdAt: string;
  sourceAttemptIds: string[];
}

interface EligibleBoss {
  milestone: number | null;
  currentLevel: number;
  activeBossId: string | null;
}

export function ArenaOverview() {
  const [startingBoss, setStartingBoss] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const [progression, tasks] = await Promise.all([
      apiGet<Progression>('/assessments/progression'),
      apiGet<RemediationTask[]>('/assessments/remediation'),
    ]);
    const boss = await apiGet<EligibleBoss>('/assessments/boss/eligible').catch(() => null);
    return { progression, tasks, boss };
  }, []);

  const { data, error, setError, refetch } = useApi(load);
  const p = data?.progression ?? null;
  const tasks = data?.tasks ?? [];
  const boss = data?.boss ?? null;

  async function startBoss() {
    if (!boss?.milestone) return;
    setStartingBoss(true);
    try {
      const task = await apiPost<{ id: string }>('/assessments/boss/start', {
        milestone: boss.milestone,
      });
      router.push(`/arena/boss/${task.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStartingBoss(false);
    }
  }

  async function completeTask(id: string) {
    setCompletingId(id);
    try {
      await apiPost(`/assessments/remediation/${id}/complete`);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCompletingId(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!p) return <Skeleton />;

  const progressPct =
    p.level.xpToNext + p.level.xpInLevel > 0
      ? (p.level.xpInLevel / (p.level.xpInLevel + p.level.xpToNext)) * 100
      : 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 md:grid-cols-3">
        <Stat
          icon={Trophy}
          label="Level"
          value={p.level.level.toString()}
          hint={`${p.level.xpInLevel} / ${p.level.xpInLevel + p.level.xpToNext} XP`}
          progress={progressPct}
        />
        <Stat
          icon={Sparkles}
          label="Total XP"
          value={p.totalXp.toLocaleString()}
          hint={`${p.attemptsTotal} attempts`}
        />
        <Stat
          icon={Flame}
          label="Streak"
          value={`${p.streakDays}d`}
          hint={p.longestStreakDays > p.streakDays ? `Longest: ${p.longestStreakDays}d` : 'Longest so far'}
        />
      </section>

      {boss && (boss.activeBossId || boss.milestone !== null) && (
        <section
          className="flex flex-col gap-3 rounded-[var(--radius)] border border-accent/40 bg-accent/10 px-5 py-4 md:flex-row md:items-center md:justify-between"
          role="status"
        >
          <div className="flex items-start gap-3">
            <Swords className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                Boss battle
              </span>
              <span className="text-[15px] font-medium text-fg">
                {boss.activeBossId
                  ? 'You have an active boss battle. Finish it before it expires.'
                  : `Level ${boss.milestone} milestone unlocked. Ready when you are.`}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {boss.activeBossId ? (
              <Link href={`/arena/boss/${boss.activeBossId}`}>
                <Button size="sm">Resume boss</Button>
              </Link>
            ) : (
              <Button size="sm" onClick={startBoss} disabled={startingBoss}>
                {startingBoss ? 'Starting' : 'Start boss battle'}
              </Button>
            )}
          </div>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            Remediation
          </h2>
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex flex-col gap-3 rounded-[var(--radius)] border border-warning/30 bg-warning/5 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="flex flex-col gap-0.5">
                    <div className="font-mono text-[13px] text-fg">#{t.skillId}</div>
                    <div className="text-[12.5px] leading-relaxed text-fg-muted">{t.reason}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/arena/knowledge?skillId=${encodeURIComponent(t.skillId)}`}>
                    <Button size="sm">Knowledge</Button>
                  </Link>
                  <Link href={`/arena/code-review?skillId=${encodeURIComponent(t.skillId)}`}>
                    <Button size="sm" variant="ghost">Code review</Button>
                  </Link>
                  <Link href={`/arena/system-design?skillId=${encodeURIComponent(t.skillId)}`}>
                    <Button size="sm" variant="ghost">System design</Button>
                  </Link>
                  <Link href={`/arena/debugging?skillId=${encodeURIComponent(t.skillId)}`}>
                    <Button size="sm" variant="ghost">Debugging</Button>
                  </Link>
                  <Link href={`/arena/mock-interview?skillId=${encodeURIComponent(t.skillId)}`}>
                    <Button size="sm" variant="ghost">Mock interview</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => completeTask(t.id)}
                    disabled={completingId === t.id}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Recommended today
        </h2>
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-fg">Knowledge check</div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              One question, keyboard-first grader. Writes evidence against the mapped skills so your dashboard reflects the attempt within one worker cycle.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena/knowledge">
              <Button>
                Start knowledge quest <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/arena/progression">
              <Button variant="ghost">View progression</Button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-fg">Code review</div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Read a small diff, list every defect you spot. Grader scores precision and recall
              against a hidden answer key.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena/code-review">
              <Button>
                Start code review <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-fg">System design</div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Write a design for a scenario with hard constraints. Graded against a five-dimension
              rubric (scalability, reliability, cost, trade-offs, clarity).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena/system-design">
              <Button>
                Start system design <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-fg">Debugging</div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              A small broken snippet with one hidden root cause. Fix it in place. Graded on
              correctness (did you fix the bug) and minimality (did you change only what needed).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena/debugging">
              <Button>
                Start debugging <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-fg">Mock interview</div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Three questions in one sitting: two technical, one behavioral. Panel-style summary
              at the end.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena/mock-interview">
              <Button>
                Start mock interview <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        <PendingRow label="Coding runner" scheduled="slice 11+ (Docker sandbox + Monaco)" />
        <PendingRow label="Verbal defense" scheduled="slice 12+ (whisper.cpp)" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Recent XP
        </h2>
        {p.recentXp.length === 0 ? (
          <EmptyRecent />
        ) : (
          <div className="flex flex-col gap-1">
            {p.recentXp.map((x) => (
              <div
                key={x.id}
                className="flex items-center justify-between rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2 text-[13px]"
              >
                <span className="font-mono text-fg-subtle">{x.reason}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-fg-faint">
                    {new Date(x.createdAt).toLocaleString()}
                  </span>
                  <span className="font-mono font-medium text-accent">+{x.xp} XP</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  progress?: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-fg-subtle" />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          {label}
        </span>
      </div>
      <div className="font-mono text-[28px] font-medium leading-none text-fg">{value}</div>
      <div className="text-[12px] text-fg-muted">{hint}</div>
      {typeof progress === 'number' && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-[hsl(var(--bg))]">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PendingRow({ label, scheduled }: { label: string; scheduled: string }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <span className="text-[14px] font-medium text-fg-subtle">{label}</span>
      <span className="text-[12px] text-fg-faint">Lands in {scheduled}</span>
    </div>
  );
}

function EmptyRecent() {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-8 text-center text-[13px] text-fg-subtle">
      No XP yet. Your first attempt lands here.
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}

