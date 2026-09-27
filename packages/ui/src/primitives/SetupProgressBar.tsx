'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils';

export interface ProgressStep {
  slug: string;
  title: string;
  section: string;
}

interface SetupProgressBarProps {
  steps: readonly ProgressStep[];
  sections: readonly string[];
  basePath: string;
  brand?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export function SetupProgressBar({
  steps,
  sections,
  basePath,
  brand,
  rightSlot,
}: SetupProgressBarProps) {
  const pathname = usePathname();
  const currentIdx = Math.max(
    0,
    steps.findIndex((s) => pathname?.endsWith(s.slug)),
  );
  const currentStep = steps[currentIdx]!;
  const totalSteps = steps.length;
  const currentSectionIdx = sections.indexOf(currentStep.section);

  return (
    <aside className="sticky top-0 flex h-screen w-[240px] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg))/0.72] backdrop-blur-xl">
      {/* Brand + current step context */}
      <div className="flex flex-col gap-5 px-5 pt-7 pb-6">
        {brand && <div className="flex items-center gap-2.5">{brand}</div>}

        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] font-medium tabular-nums text-fg-subtle">
            {String(currentIdx + 1).padStart(2, '0')}
            <span className="text-fg-faint"> / {String(totalSteps).padStart(2, '0')}</span>
            <span className="text-fg-faint"> · </span>
            <span className="text-fg-muted">{currentStep.section}</span>
          </span>
          <AnimatePresence mode="wait">
            <motion.span
              key={currentStep.slug}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="text-[15.5px] font-semibold leading-tight tracking-tight text-fg"
            >
              {currentStep.title}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      {/* Section stepper: circular markers connected by a vertical line */}
      <ol className="flex flex-1 flex-col px-5 py-2">
        {sections.map((section, sIdx) => {
          const isLast = sIdx === sections.length - 1;
          const isPast = sIdx < currentSectionIdx;
          const isCurrent = sIdx === currentSectionIdx;
          const lineFilled = sIdx < currentSectionIdx;
          const sectionSteps = steps
            .map((s, i) => ({ ...s, globalIdx: i }))
            .filter((s) => s.section === section);

          return (
            <li key={section} className="flex gap-3">
              {/* Marker column: circle + connecting line */}
              <div className="flex flex-col items-center">
                <SectionMarker
                  sectionNumber={sIdx + 1}
                  isPast={isPast}
                  isCurrent={isCurrent}
                />
                {!isLast && (
                  <div
                    className={cn(
                      'my-1 w-px flex-1 transition-colors duration-500',
                      lineFilled
                        ? 'bg-[hsl(var(--accent))]'
                        : 'bg-[hsl(var(--border-strong))]',
                    )}
                    style={{ minHeight: '20px' }}
                  />
                )}
              </div>

              {/* Content column: section label + expanded sub-steps for current */}
              <div className={cn('flex flex-col gap-3', isLast ? 'pb-2' : 'pb-6')}>
                <span
                  className={cn(
                    'pt-1 text-[13px] leading-none tracking-tight transition-colors duration-300',
                    isCurrent
                      ? 'font-semibold text-fg'
                      : isPast
                        ? 'font-medium text-fg-muted'
                        : 'font-medium text-fg-faint',
                  )}
                >
                  {section}
                </span>

                <AnimatePresence initial={false}>
                  {isCurrent && (
                    <motion.ol
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="flex flex-col gap-1.5 overflow-hidden"
                    >
                      {sectionSteps.map((step) => {
                        const isStepPast = step.globalIdx < currentIdx;
                        const isStepCurrent = step.globalIdx === currentIdx;
                        const clickable = isStepPast || isStepCurrent;
                        const content = (
                          <span
                            className={cn(
                              'flex items-center gap-2 text-[12px] leading-tight transition-colors duration-200',
                              isStepCurrent
                                ? 'font-medium text-fg'
                                : isStepPast
                                  ? 'text-fg-muted hover:text-fg'
                                  : 'text-fg-faint',
                            )}
                          >
                            <StepDot state={isStepCurrent ? 'current' : isStepPast ? 'past' : 'future'} />
                            {step.title}
                          </span>
                        );
                        return (
                          <li key={step.slug}>
                            {clickable ? (
                              <Link href={`${basePath}/${step.slug}`}>{content}</Link>
                            ) : (
                              content
                            )}
                          </li>
                        );
                      })}
                    </motion.ol>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Footer link */}
      <div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] px-5 py-4">
        {rightSlot ?? (
          <Link
            href="/sign-in"
            className="text-[12.5px] font-medium text-fg-muted transition-colors duration-200 hover:text-fg"
          >
            Sign in →
          </Link>
        )}
      </div>
    </aside>
  );
}

function SectionMarker({
  sectionNumber,
  isPast,
  isCurrent,
}: {
  sectionNumber: number;
  isPast: boolean;
  isCurrent: boolean;
}) {
  return (
    <div
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full transition-all duration-300',
        isPast || isCurrent
          ? 'bg-[hsl(var(--accent))] text-white'
          : 'border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] text-fg-faint',
      )}
      style={{
        boxShadow: isCurrent
          ? '0 0 0 3px hsl(var(--accent) / 0.18), 0 0 14px hsl(var(--accent) / 0.35)'
          : undefined,
      }}
    >
      {isPast ? (
        <Check className="h-3 w-3" strokeWidth={2.8} />
      ) : (
        <span className="text-[10.5px] font-semibold leading-none">{sectionNumber}</span>
      )}
    </div>
  );
}

function StepDot({ state }: { state: 'past' | 'current' | 'future' }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-300',
        state === 'current' && 'bg-[hsl(var(--accent))] scale-125',
        state === 'past' && 'bg-[hsl(var(--fg-muted))]',
        state === 'future' && 'bg-[hsl(var(--fg-faint))]',
      )}
    />
  );
}
