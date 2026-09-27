import { Eyebrow } from '@careeros/ui';
import { SystemDesignRunner } from '@/components/arena/SystemDesignRunner';

export default function SystemDesignArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Arena · System design</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          System design
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          Read the scenario and constraints. Write your design. Grader scores you against a
          five-dimension rubric (scalability, reliability, cost, trade-offs, clarity) and writes
          evidence to the mapped skill.
        </p>
      </header>
      <SystemDesignRunner />
    </main>
  );
}
