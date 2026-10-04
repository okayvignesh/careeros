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
          This is the single targeting profile. It scopes which jobs are discovered, ranks
          them by fit, and gates Apply and Recommended to roles you&apos;re authorized for or
          that likely sponsor. Eligibility is a floor, not a shortcut — every application
          still goes through your approval queue.
        </p>
      </header>
      <JobPreferencesPanel />
    </main>
  );
}
