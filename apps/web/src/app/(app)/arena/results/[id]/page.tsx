import { Eyebrow } from '@careeros/ui';
import { AttemptResult } from '@/components/arena/AttemptResult';

export default function AttemptResultPage({ params }: { params: { id: string } }) {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Attempt</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Attempt result
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Grading, XP, streak, and the exact skill deltas your evidence graph moved through.
        </p>
      </header>
      <AttemptResult id={params.id} />
    </main>
  );
}
