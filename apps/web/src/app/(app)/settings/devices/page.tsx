import { Eyebrow } from '@careeros/ui';
import { AgentDownloadCard } from '@/components/settings/AgentDownloadCard';
import { DevicesPanel } from '@/components/settings/DevicesPanel';

export default function DevicesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Devices</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Devices &amp; desktop agent
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Pair the desktop companion, see which machines are connected and when they last checked in,
          and revoke any device you no longer trust.
        </p>
      </header>
      <DevicesPanel />
      <AgentDownloadCard />
    </main>
  );
}
