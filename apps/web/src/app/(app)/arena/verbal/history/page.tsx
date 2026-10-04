import { Eyebrow } from '@careeros/ui';
import { VerbalHistory } from '@/components/arena/verbal/VerbalHistory';

// ponytail: see arena/verbal/page.tsx for rationale.
export const dynamic = 'force-dynamic';

export default function VerbalHistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Verbal defense</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Spoken history</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every recording, its transcript, and the score the grader returned. Sessions that failed
          transcription or ran without speech-to-text show their real status rather than a number.
        </p>
      </header>
      <VerbalHistory />
    </main>
  );
}
