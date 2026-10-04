import { Eyebrow } from '@careeros/ui';
import { QuestDetail } from '@/components/quests/QuestDetail';

export default async function QuestDetailPage({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Quest detail</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Quest</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Why this quest is prioritised, what it unlocks, and where your evidence stands today.
        </p>
      </header>
      <QuestDetail skillId={skillId} />
    </main>
  );
}
