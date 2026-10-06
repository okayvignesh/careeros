import { Eyebrow } from '@careeros/ui';
import { QuestBoard } from '@/components/quests/QuestBoard';

export default function QuestsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Quests</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Quests</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          A learning plan ordered by market relevance, role gap, and confidence — respecting the
          prerequisite graph so you never practise a skill before its foundations.
        </p>
      </header>
      <QuestBoard />
    </main>
  );
}
