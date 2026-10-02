import { Eyebrow } from '@careeros/ui';
import { FactBase } from '@/components/facts/FactBase';

export default function FactsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Fact base</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Verified facts
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          The candidate twin&apos;s ground truth. Every generated document may only rephrase these
          facts. Toggle a row off if it becomes wrong.
        </p>
      </header>
      <FactBase />
    </main>
  );
}
