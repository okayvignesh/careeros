import { Eyebrow } from '@careeros/ui';
import { ResumeVariantView } from '@/components/resume/ResumeVariantView';

export default async function ResumeVariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Resume variant</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Tailored resume
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Grounded in your verified facts. Every bullet cites the fact it came from. PDF and
          DOCX export land in a later slice; for now, copy-paste from below.
        </p>
      </header>
      <ResumeVariantView id={id} />
    </main>
  );
}
