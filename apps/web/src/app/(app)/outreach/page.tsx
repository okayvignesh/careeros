import { Eyebrow } from '@careeros/ui';
import { OutreachPanel } from '@/components/outreach/OutreachPanel';

export default function OutreachPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Controlled execution · Outreach</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Outreach drafts
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Cold outreach only works when it is obviously not automated. Drafts are grounded in your
          evidence, fact-checked server-side, and queued for approval before anything sends.
        </p>
      </header>
      <OutreachPanel />
    </main>
  );
}
