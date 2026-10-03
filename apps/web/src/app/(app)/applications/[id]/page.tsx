import { Eyebrow } from '@careeros/ui';
import { ApplicationDetail } from '@/components/applications/ApplicationDetail';

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Application</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Application detail
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          One application, every state change on the record. Move it through the pipeline and
          attach notes; each transition writes an immutable event.
        </p>
      </header>
      <ApplicationDetail id={id} />
    </main>
  );
}
