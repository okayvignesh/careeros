import { Eyebrow } from '@careeros/ui';
import { DebuggingRunner } from '@/components/arena/DebuggingRunner';

// ponytail: see arena/knowledge/page.tsx for rationale.
export const dynamic = 'force-dynamic';

export default function DebuggingArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Debugging</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Debugging
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Read the description, spot the bug, submit a fix. Grader scores correctness (does the
          fix address the root cause) and minimality (did you change only what was needed).
        </p>
      </header>
      <DebuggingRunner />
    </main>
  );
}
