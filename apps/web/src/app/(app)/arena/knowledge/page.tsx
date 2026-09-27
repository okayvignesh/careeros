import { Eyebrow } from '@careeros/ui';
import { KnowledgeRunner } from '@/components/arena/KnowledgeRunner';

// ponytail: runner is a 'use client' component calling useSearchParams(). Next 15
// requires either a <Suspense> boundary around it or opt-out of prerender.
// This page is fully client-driven (all data via apiGet), so nothing is lost.
export const dynamic = 'force-dynamic';

export default function KnowledgeArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Knowledge</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Knowledge check
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          One question at a time. Your answer is graded against the question&rsquo;s key concepts;
          grading writes evidence to the mapped skills. Keyboard first: Cmd/Ctrl+Enter to submit.
        </p>
      </header>
      <KnowledgeRunner />
    </main>
  );
}
