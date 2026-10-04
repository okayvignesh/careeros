import { Eyebrow } from '@careeros/ui';
import { SecurityPanel } from '@/components/settings/SecurityPanel';

export default function SecurityPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Security</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Security
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Add passwordless sign-in to this account. A passkey never leaves your device; the server
          stores only the public key it uses to verify you.
        </p>
      </header>
      <SecurityPanel />
    </main>
  );
}
