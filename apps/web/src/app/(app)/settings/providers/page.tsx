import { Eyebrow } from '@careeros/ui';
import { ProvidersPanel } from '@/components/settings/ProvidersPanel';

export default function ProvidersPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · AI providers</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          AI providers
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Switch between LLM providers, add a new one, and probe the active connection. Employer-confidential
          data never leaves your local-only providers by default (change per-provider ceilings under Usage).
        </p>
      </header>
      <ProvidersPanel />
    </main>
  );
}
