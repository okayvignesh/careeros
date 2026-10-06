import { Eyebrow } from '@careeros/ui';
import { VerbalRunner } from '@/components/arena/verbal/VerbalRunner';

// ponytail: the runner is fully client-driven (all data via apiGet). Read the
// skillId on the server so the runner itself needs no useSearchParams/Suspense.
export const dynamic = 'force-dynamic';

export default async function VerbalArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ skillId?: string }>;
}) {
  const { skillId } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · Verbal defense</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Say it out loud
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Answer the prompt aloud. The server transcribes the recording, then grades the transcript
          against the question&rsquo;s key points and writes evidence to the mapped skills. If
          speech-to-text isn&rsquo;t available, you can type the answer instead — no score is ever
          invented from audio alone.
        </p>
      </header>
      <VerbalRunner skillId={skillId ?? ''} />
    </main>
  );
}
