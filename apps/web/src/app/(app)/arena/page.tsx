import Link from 'next/link';
import { ArrowRight, Mic } from 'lucide-react';
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
      <Link
        href="/arena/verbal"
        data-testid="arena-verbal-entry"
        className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-accent/40 bg-accent/10 px-5 py-4 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
      >
        <span className="flex items-start gap-3">
          <Mic className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-medium text-fg">Verbal defense</span>
            <span className="text-[13px] leading-relaxed text-fg-muted">
              Answer a prompt aloud. The transcript is graded against its key points.
            </span>
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-accent" />
      </Link>
      <ArenaOverview />
    </main>
  );
}
