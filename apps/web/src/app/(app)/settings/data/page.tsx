import { Eyebrow } from '@careeros/ui';
import { DataPrivacyPanel } from '@/components/settings/DataPrivacyPanel';

export default function DataPrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Data &amp; privacy</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Data &amp; privacy
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          There is no other copy of your data. Export it as an encrypted archive, review what any
          object is allowed to leave this host, or delete the account through re-authentication.
        </p>
      </header>
      <DataPrivacyPanel />
    </main>
  );
}
