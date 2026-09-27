import { Eyebrow } from '@careeros/ui';
import { MockInterviewRunner } from '@/components/arena/MockInterviewRunner';

// ponytail: see arena/knowledge/page.tsx for rationale.
export const dynamic = 'force-dynamic';

export default function MockInterviewArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Mock interview</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Mock interview
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Three questions: two technical, one behavioral. Submit all three at once. Grader scores
          each individually and gives a panel-style summary; evidence lands on the mapped skills.
        </p>
      </header>
      <MockInterviewRunner />
    </main>
  );
}
