import Link from 'next/link';
import { ArrowRight, FileCheck2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Eyebrow } from '@careeros/ui';

const pillars = [
  {
    icon: FileCheck2,
    title: 'Evidence, not claims',
    body: 'Every skill traces to a source. Nothing generated without a fact ID.',
  },
  {
    icon: Sparkles,
    title: 'Provider-agnostic',
    body: 'DeepSeek default. Any OpenAI-compatible provider slots in without a redeploy.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval-gated actions',
    body: 'No auto-send. Every outbound step reviewed. Full audit trail.',
  },
];

export default function HomePage() {
  return (
    <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1200px] grid-rows-[1fr_auto] gap-16 px-12 py-16 md:py-24">
      <section className="flex flex-col justify-center gap-10">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-2))]">
            <span className="h-3 w-3 rounded-[3px] bg-[hsl(var(--accent))]" />
          </span>
          <Eyebrow>Career OS · v0.0.1 · Self-hosted alpha</Eyebrow>
        </div>

        <div className="flex flex-col gap-6">
          <h1 className="max-w-3xl text-[64px] font-semibold leading-[1] tracking-[-0.035em] text-fg md:text-[76px]">
            Your career,
            <br />
            <span className="text-fg-muted">as an evidence graph.</span>
          </h1>
          <p className="max-w-xl text-[17px] leading-[1.55] text-fg-muted">
            A personal, self-hosted operating system for candidacy. Resume, GitHub, assessments,
            market signals and applications stitched into one continuously-updated candidate model.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/setup/01-preflight">
            <Button size="lg">
              Start setup <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-8 border-t border-[hsl(var(--border))] pt-10 md:grid-cols-3">
        {pillars.map(({ icon: Icon, title, body }) => (
          <article key={title} className="flex flex-col gap-3">
            <Icon className="h-4 w-4 text-[hsl(var(--accent))]" strokeWidth={1.8} />
            <h3 className="text-[14px] font-medium tracking-tight text-fg">{title}</h3>
            <p className="text-[13px] leading-[1.6] text-fg-muted">{body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
