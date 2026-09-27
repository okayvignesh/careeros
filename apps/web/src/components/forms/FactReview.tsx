'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Briefcase, Check, GraduationCap, Sparkles, Wrench, X, type LucideIcon } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Eyebrow, cn } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner } from './AccountForm';

interface Employment { company: string; title: string; start: string | null; end: string | null; bullets: string[] }
interface Education { school: string; degree: string; field: string | null; year: string | null }
interface Skill { name: string; evidence: string | null }
interface Project { name: string; description: string }

interface ExtractedFacts {
  headline: string | null;
  location: string | null;
  employment: Employment[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
}

type Selected = Record<string, boolean>;

export function FactReview() {
  const router = useRouter();
  const [facts, setFacts] = useState<ExtractedFacts | null>(null);
  const [sel, setSel] = useState<Selected>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('careeros:extracted-facts');
    if (!raw) {
      router.replace('/setup/09-resume');
      return;
    }
    const parsed = JSON.parse(raw) as ExtractedFacts;
    setFacts(parsed);
    const initial: Selected = {};
    parsed.employment.forEach((_, i) => (initial[`emp-${i}`] = true));
    parsed.education.forEach((_, i) => (initial[`edu-${i}`] = true));
    parsed.skills.forEach((_, i) => (initial[`skill-${i}`] = true));
    parsed.projects.forEach((_, i) => (initial[`proj-${i}`] = true));
    setSel(initial);
  }, [router]);

  function toggle(id: string) {
    setSel((s) => ({ ...s, [id]: !s[id] }));
  }

  async function confirm() {
    if (!facts) return;
    setBusy(true);
    setErr(null);
    try {
      const curated: ExtractedFacts = {
        headline: facts.headline,
        location: facts.location,
        employment: facts.employment.filter((_, i) => sel[`emp-${i}`]),
        education: facts.education.filter((_, i) => sel[`edu-${i}`]),
        skills: facts.skills.filter((_, i) => sel[`skill-${i}`]),
        projects: facts.projects.filter((_, i) => sel[`proj-${i}`]),
      };
      await apiPost('/resume/confirm', { facts: curated });
      await apiPost('/setup/resume/confirm', {});
      sessionStorage.removeItem('careeros:extracted-facts');
      router.push('/setup/11-goals');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!facts) {
    return (
      <div className="panel flex items-center justify-center px-5 py-10">
        <ThinkingOrb state="working" size={20} />
      </div>
    );
  }

  const accepted = Object.values(sel).filter(Boolean).length;
  const total = Object.keys(sel).length;

  return (
    <div className="flex flex-col gap-5">
      {(facts.headline || facts.location) && (
        <div className="panel flex flex-col gap-2 p-5">
          {facts.headline && (
            <span className="text-[15px] font-medium text-fg">{facts.headline}</span>
          )}
          {facts.location && (
            <span className="text-[12.5px] text-fg-muted">{facts.location}</span>
          )}
        </div>
      )}

      <Group icon={Briefcase} label="Employment">
        {facts.employment.map((e, i) => (
          <FactRow
            key={`emp-${i}`}
            id={`emp-${i}`}
            selected={!!sel[`emp-${i}`]}
            onToggle={toggle}
            index={i}
          >
            <div className="flex flex-col gap-1">
              <span className="text-[13.5px] font-medium text-fg">
                {e.title} · <span className="text-fg-muted">{e.company}</span>
              </span>
              <span className="text-[12px] text-fg-subtle">
                {e.start ?? '–'}{e.end === null ? ' → Present' : e.end ? ` → ${e.end}` : ''}
              </span>
              {e.bullets.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {e.bullets.slice(0, 3).map((b, j) => (
                    <li key={j} className="text-[12.5px] leading-snug text-fg-muted">· {b}</li>
                  ))}
                </ul>
              )}
            </div>
          </FactRow>
        ))}
      </Group>

      <Group icon={GraduationCap} label="Education">
        {facts.education.map((e, i) => (
          <FactRow
            key={`edu-${i}`}
            id={`edu-${i}`}
            selected={!!sel[`edu-${i}`]}
            onToggle={toggle}
            index={i}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-medium text-fg">
                {e.degree}
                {e.field ? <span className="text-fg-muted"> · {e.field}</span> : null}
              </span>
              <span className="text-[12px] text-fg-subtle">
                {e.school}
                {e.year ? ` · ${e.year}` : ''}
              </span>
            </div>
          </FactRow>
        ))}
      </Group>

      <Group icon={Wrench} label="Skills">
        <div className="flex flex-wrap gap-1.5 p-3">
          {facts.skills.map((s, i) => {
            const on = !!sel[`skill-${i}`];
            return (
              <motion.button
                key={`skill-${i}`}
                type="button"
                onClick={() => toggle(`skill-${i}`)}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors duration-200',
                  on
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.14)] text-fg'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] text-fg-subtle line-through',
                )}
              >
                {s.name}
              </motion.button>
            );
          })}
        </div>
      </Group>

      <Group icon={Sparkles} label="Projects">
        {facts.projects.map((p, i) => (
          <FactRow
            key={`proj-${i}`}
            id={`proj-${i}`}
            selected={!!sel[`proj-${i}`]}
            onToggle={toggle}
            index={i}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-medium text-fg">{p.name}</span>
              <span className="text-[12.5px] leading-snug text-fg-muted">{p.description}</span>
            </div>
          </FactRow>
        ))}
      </Group>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-2">
        <Button size="lg" onClick={confirm} disabled={busy || accepted === 0}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Committing…
            </>
          ) : (
            <>
              Commit {accepted} of {total} facts <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Group({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
        <Eyebrow>{label}</Eyebrow>
      </div>
      <div className="panel divide-y divide-[hsl(var(--border))]">{children}</div>
    </div>
  );
}

function FactRow({
  id,
  selected,
  onToggle,
  index,
  children,
}: {
  id: string;
  selected: boolean;
  onToggle: (id: string) => void;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'flex items-start justify-between gap-4 px-5 py-3.5 transition-opacity duration-200',
        !selected && 'opacity-50',
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all duration-200',
          selected
            ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-white'
            : 'border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] text-fg-subtle hover:border-[hsl(var(--border-active))]',
        )}
        aria-pressed={selected}
      >
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.span
              key="on"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </motion.span>
          ) : (
            <motion.span
              key="off"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.div>
  );
}
