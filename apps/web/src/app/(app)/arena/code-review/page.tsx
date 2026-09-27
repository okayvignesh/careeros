import { Eyebrow } from '@careeros/ui';
import { CodeReviewRunner } from '@/components/arena/CodeReviewRunner';

// ponytail: see arena/knowledge/page.tsx for rationale.
export const dynamic = 'force-dynamic';

export default function CodeReviewArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Code review</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Code review
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Read the diff, list every defect you spot. One finding per line. Grader compares
          against a hidden answer key and scores precision and recall; evidence lands against
          the mapped skills.
        </p>
      </header>
      <CodeReviewRunner />
    </main>
  );
}
