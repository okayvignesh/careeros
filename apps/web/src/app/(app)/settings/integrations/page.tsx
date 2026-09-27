import { Eyebrow } from '@careeros/ui';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';

export default function IntegrationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Integrations</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Integrations
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Reauth, resync, and revoke connected services. Slack and Gmail land in P5.
        </p>
      </header>
      <IntegrationsPanel />
    </main>
  );
}
