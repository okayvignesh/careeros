import { Eyebrow } from '@careeros/ui';
import { JobPreferencesPanel } from '@/components/settings/JobPreferencesPanel';

export default function JobPreferencesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Job preferences</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Job preferences
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Drives the relevance filter on the Jobs page. Live filters today: remote-only,
          must-have skills, dealbreaker skills, company blacklist, and freshness window.
          Target roles, locations, comp band, and seniority are collected here for when their
          respective classifiers ship in later slices.
        </p>
      </header>
      <JobPreferencesPanel />
    </main>
  );
}
