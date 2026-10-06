import { Eyebrow } from '@careeros/ui';
import { RepositoryAnalysis } from '@/components/repository-analysis/RepositoryAnalysis';

export default function RepositoryAnalysisPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Repositories</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Repository analysis</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          What your synced GitHub evidence says about each repository: language mix, commit
          activity, the skills it demonstrates, and how likely the code was AI-assisted. Computed
          from the evidence graph — never inferred claims.
        </p>
      </header>
      <RepositoryAnalysis />
    </main>
  );
}
