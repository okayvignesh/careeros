import { Eyebrow } from '@careeros/ui';
import { AuditLog } from '@/components/settings/AuditLog';

export default function AuditLogPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Audit log</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Everything, on the record
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Append-only record of every approval, outbound action, and credential change. Filter by
          actor, action, source, and time. Payloads are redacted server-side before they reach the
          browser.
        </p>
      </header>
      <AuditLog />
    </main>
  );
}
