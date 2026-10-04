import { Eyebrow } from '@careeros/ui';
import { SourceVerification } from '@/components/jobs/SourceVerification';

export default function SourceVerificationPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Jobs · Source verification</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Source verification
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every posting&apos;s trust state, and what it would take to change it. Rejections keep a
          reason and stay on the record even after a successful re-verify.
        </p>
      </header>
      <SourceVerification />
    </main>
  );
}
