import { Eyebrow } from '@careeros/ui';
import { InterviewPrepPanel } from '@/components/interview-prep/InterviewPrepPanel';

export default async function InterviewPrepPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Interview prep</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Interview prep
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Likely topics ranked by how likely they are and how strong your evidence is. Talk-tracks
          are drafted only from facts your fact base already holds.
        </p>
      </header>
      <InterviewPrepPanel applicationId={applicationId} />
    </main>
  );
}
