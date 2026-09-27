import { Eyebrow } from '@careeros/ui';
import { SkillTree } from '@/components/skills/SkillTree';

export default function SkillsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Skills</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Skill graph
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Every skill in the seed catalog, grouped by cluster. Rows with evidence show your current
          level; grey rows are candidates the graph can absorb once evidence lands.
        </p>
      </header>
      <SkillTree />
    </main>
  );
}
