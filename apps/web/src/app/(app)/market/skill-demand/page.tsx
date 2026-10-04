import { SectionHeader, Button } from '@careeros/ui';
import { SkillDemandTable } from '@/components/market-demand/SkillDemandTable';

export default function SkillDemandPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-12 py-14">
      <SectionHeader
        eyebrow="Market"
        title="Skill demand"
        description="What the market asked for, by skill, against what your evidence currently supports."
        trailing={<Button>Add to learning plan</Button>}
      />
      <SkillDemandTable />
    </main>
  );
}
