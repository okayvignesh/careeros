import { Eyebrow } from '@careeros/ui';
import { EvidenceExplorer } from '@/components/evidence/EvidenceExplorer';

export default function EvidencePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Evidence</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Evidence explorer
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every proof the graph has absorbed. Filter by kind, signal, or freshness. Rows are
          immutable, append-only.
        </p>
      </header>
      <EvidenceExplorer />
    </main>
  );
}
