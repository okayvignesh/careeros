import { Eyebrow } from '@careeros/ui';
import { BossRunner } from '@/components/arena/BossRunner';

export default async function BossArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Boss battle</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Boss battle
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Three questions, one timer, server-authoritative. Submit before it hits zero; late
          submissions are rejected. Pass at 70% overall to clear the milestone.
        </p>
      </header>
      <BossRunner id={id} />
    </main>
  );
}
