import { Eyebrow } from '@careeros/ui';
import { ProgressionPanel } from '@/components/arena/ProgressionPanel';

export default function ProgressionPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Progression</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Progression
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Level and XP trail your attempts. Streak is a behaviour signal, not a capability metric.
          Skill proficiency lives on the dashboard.
        </p>
      </header>
      <ProgressionPanel />
    </main>
  );
}
