import { SetupProgressBar, PageReveal } from '@careeros/ui';
import { SETUP_STEPS, SETUP_SECTIONS } from '@careeros/shared/constants';
import { BrandMark } from '@/components/Brand';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 grid min-h-screen grid-cols-[240px_minmax(0,1fr)]">
      <SetupProgressBar
        steps={SETUP_STEPS}
        sections={SETUP_SECTIONS}
        basePath="/setup"
        brand={
          <>
            <BrandMark className="h-7 w-7" />
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
