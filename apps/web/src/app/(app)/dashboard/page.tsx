import { Eyebrow } from '@careeros/ui';
import { ContributionHeatmap } from '@/components/dashboard/ContributionHeatmap';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { LevelHeader } from '@/components/dashboard/LevelHeader';
import { RecentEvidence } from '@/components/dashboard/RecentEvidence';
import { TopSkills } from '@/components/dashboard/TopSkills';

export default function DashboardPage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-8 px-12 py-14">
      <header className="flex flex-col gap-3">
        <Eyebrow>Dashboard</Eyebrow>
        <h1 className="text-[40px] font-semibold leading-tight tracking-[-0.025em]">
          Your evidence graph
        </h1>
      </header>

      <LevelHeader />

      <ContributionHeatmap />

      <section className="grid gap-6 md:grid-cols-2">
        <TopSkills />
        <RecentEvidence />
      </section>

      <KpiRow />
    </main>
  );
}
