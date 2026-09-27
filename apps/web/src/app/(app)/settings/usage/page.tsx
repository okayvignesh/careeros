import { UsageDashboard } from '@/components/settings/UsageDashboard';
import { Eyebrow } from '@careeros/ui';

export default function UsagePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Usage & costs</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          What your AI is spending
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every provider call is logged with tokens, latency, and cost. Set a monthly ceiling, pause the graph if
          something runs away, and drill into which model or call kind is doing the damage.
        </p>
      </header>
      <UsageDashboard />
    </main>
  );
}
