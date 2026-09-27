import { Eyebrow } from '@careeros/ui';
import { CoverLetterView } from '@/components/resume/CoverLetterView';

export default async function CoverLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Cover letter</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Tailored cover letter
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Grounded in your verified facts. Every paragraph cites the facts it draws from.
          Same fact-check gate as the resume: paragraphs that fabricate claims get dropped.
        </p>
      </header>
      <CoverLetterView id={id} />
    </main>
  );
}
