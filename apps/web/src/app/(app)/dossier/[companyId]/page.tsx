import { Eyebrow } from '@careeros/ui';
import { CompanyDossier } from '@/components/dossier/CompanyDossier';

export default async function CompanyDossierPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Company</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Company dossier</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Sourced facts only. Confidence is about the detection, not an endorsement — and no single
          review is treated as representative.
        </p>
      </header>
      <CompanyDossier companyId={companyId} />
    </main>
  );
}
