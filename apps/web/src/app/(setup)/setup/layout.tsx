import { SetupProgressBar, PageReveal } from '@careeros/ui';
import { SETUP_STEPS, SETUP_SECTIONS } from '@careeros/shared/constants';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 grid min-h-screen grid-cols-[240px_minmax(0,1fr)]">
      <SetupProgressBar
        steps={SETUP_STEPS}
        sections={SETUP_SECTIONS}
        basePath="/setup"
        brand={
          <>
            <span className="grid h-8 w-8 place-items-center rounded-[9px] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-2))]">
              <span className="h-3 w-3 rounded-[3px] bg-[hsl(var(--accent))]" />
            </span>
            <span className="text-[13.5px] font-semibold tracking-tight text-fg">Career OS</span>
          </>
        }
      />
      <main className="min-w-0">
        <PageReveal>{children}</PageReveal>
      </main>
    </div>
  );
}
