import { Eyebrow } from '@careeros/ui';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';

// IntegrationsPanel reads `?connected=` via useSearchParams(), so opt out of
// prerender rather than adding a Suspense boundary (same pattern as
// arena/knowledge/page.tsx).
export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Integrations</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Integrations
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Connect, reauth, resync, and revoke services. OAuth tokens are encrypted at rest with
          AES-GCM and scoped to the least privilege each integration needs.
        </p>
      </header>
      <IntegrationsPanel />
    </main>
  );
}
