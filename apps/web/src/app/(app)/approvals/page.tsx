import { Eyebrow } from '@careeros/ui';
import { ApprovalQueue } from '@/components/approvals/ApprovalQueue';

export default function ApprovalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Approvals</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Approval queue
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Nothing sends without your approval. Each item states exactly what will happen, and
          irreversible actions ask for a deliberate confirmation. Sensitive kinds require a fresh
          re-authentication.
        </p>
      </header>
      <ApprovalQueue />
    </main>
  );
}
