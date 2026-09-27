import { Eyebrow } from '@careeros/ui';
import { WorkersPanel } from '@/components/settings/WorkersPanel';

export default function WorkersPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · System &amp; workers</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          System &amp; workers
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Live queue depths, failed jobs, and per-queue pause/resume. Auto-refreshes every 5 seconds.
        </p>
      </header>
      <WorkersPanel />
    </main>
  );
}
