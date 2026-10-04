import { Eyebrow } from '@careeros/ui';
import { InboxPanel } from '@/components/inbox/InboxPanel';

export default function InboxPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Daily assistant · Inbox</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Inbox triage</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Recruiter mail, interview invitations and rejections, linked to the applications they
          belong to. Everything else is left alone.
        </p>
      </header>
      <InboxPanel />
    </main>
  );
}
