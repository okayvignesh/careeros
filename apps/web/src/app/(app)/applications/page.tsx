import { Eyebrow } from '@careeros/ui';
import { ApplicationsList } from '@/components/applications/ApplicationsList';

export default function ApplicationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Applications</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Applications
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Jobs you are tracking. Move each through the pipeline as things change; every
          transition is logged. Track a new job from the /jobs page.
        </p>
      </header>
      <ApplicationsList />
    </main>
  );
}
