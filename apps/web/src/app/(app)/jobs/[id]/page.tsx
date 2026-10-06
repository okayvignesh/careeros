import { Eyebrow } from '@careeros/ui';
import { JobMatchReport } from '@/components/jobs/JobMatchReport';

export default async function JobMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Jobs · Match report</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Match report</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Why this job scores what it does: each requirement, the evidence behind it, and what would
          raise the match fastest.
        </p>
      </header>
      <JobMatchReport jobId={id} />
    </main>
  );
}
