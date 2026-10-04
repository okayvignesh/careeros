import { Eyebrow } from '@careeros/ui';
import { NotificationsPanel } from '@/components/settings/NotificationsPanel';

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Notifications</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Notifications
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          What gets sent, where, and when. Nothing here can send an application or approve a draft —
          approvals always happen in the queue with the diff in view.
        </p>
      </header>
      <NotificationsPanel />
    </main>
  );
}
