import { Eyebrow } from '@careeros/ui';
import { JobSourcesPanel } from '@/components/jobs/JobSourcesPanel';

export default function JobSourcesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Job sources</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Job sources</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          The adapters this install can ingest from, grouped by trust tier. Only Tier 1 sources
          produce VERIFIED postings; discovery tiers never enter the shortlist on their own.
        </p>
      </header>
      <JobSourcesPanel />
    </main>
  );
}
