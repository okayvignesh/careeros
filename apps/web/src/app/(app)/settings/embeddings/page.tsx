import { Eyebrow } from '@careeros/ui';
import { EmbeddingsPanel } from '@/components/settings/EmbeddingsPanel';

export default function EmbeddingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Embeddings</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Embeddings
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Choose how Career OS turns text into vectors. Local runs in-process with no external calls;
          external routes through an OpenAI-compatible endpoint. Switching modes requires re-embedding.
        </p>
      </header>
      <EmbeddingsPanel />
    </main>
  );
}
