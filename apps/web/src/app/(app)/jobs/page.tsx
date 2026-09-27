import { Eyebrow } from '@careeros/ui';
import { JobsList } from '@/components/jobs/JobsList';

export default function JobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Jobs</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Jobs
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Ingested from public sources; walking-skeleton pipeline (normalize + dedupe by URL).
          Skill extraction, verification states, relevance filter, and match scoring against your
          skill graph all land in follow-up slices.
        </p>
      </header>
      <JobsList />
    </main>
  );
}
