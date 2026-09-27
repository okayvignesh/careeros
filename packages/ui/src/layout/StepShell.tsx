import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '../utils';

interface StepShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  backHref?: string | undefined;
  backLabel?: string;
  nextHref?: string | undefined;
  nextLabel?: string;
}

/**
 * Single-column centered content. Sits under the top progress bar.
 * Back link in top-left is always available when there's a previous step.
 * The footer holds Continue (when the page is content-only, no form submit).
 */
export function StepShell({
  title,
  description,
  children,
  actions,
  className,
  backHref,
  backLabel,
  nextHref,
  nextLabel = 'Continue',
}: StepShellProps) {
  const showFooter = actions || nextHref || backHref;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-8 py-12">
      {backHref && (
        <Link
          href={backHref}
          className="group inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted transition-colors duration-200 hover:text-fg"
        >
          <ArrowLeft
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
            strokeWidth={1.8}
          />
          {backLabel ?? 'Back'}
        </Link>
      )}

      <div className="flex flex-col gap-4">
        <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-0.025em] text-fg">
          {title}
        </h1>
        {description && (
          <p className="max-w-[560px] text-[15px] leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>

      <main className={cn('flex flex-col', className)}>{children}</main>

      {showFooter && (
        <footer className="flex items-center justify-between gap-3 pt-2">
          {actions ?? (
            <>
              {backHref ? (
                <Link
                  href={backHref}
                  className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors duration-200 hover:text-fg"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {backLabel ?? 'Back'}
                </Link>
              ) : (
                <span />
              )}
              {nextHref && (
                <Link
                  href={nextHref}
                  className="group inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-[hsl(var(--accent))] px-4 py-2.5 text-[13.5px] font-medium text-[hsl(var(--accent-fg))] shadow-[0_1px_0_hsl(0_0%_100%/0.14)_inset,0_6px_20px_-8px_hsl(var(--accent)/0.5)] transition-all duration-200 hover:brightness-110 active:brightness-95"
                >
                  {nextLabel}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                    strokeWidth={2}
                  />
                </Link>
              )}
            </>
          )}
        </footer>
      )}
    </div>
  );
}
