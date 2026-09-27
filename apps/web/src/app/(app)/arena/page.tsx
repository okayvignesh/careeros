import { Eyebrow } from '@careeros/ui';
import { ArenaOverview } from '@/components/arena/ArenaOverview';

export default function ArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Practice with proof
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every attempt writes evidence against the mapped skills. Level and streak are behaviour
          signals; proficiency is capability. The two are tracked separately.
        </p>
      </header>
      <ArenaOverview />
    </main>
  );
}
