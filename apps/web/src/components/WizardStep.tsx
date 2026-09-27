import { StepShell } from '@careeros/ui';
import { SETUP_STEPS } from '@careeros/shared/constants';
import { nextHref, prevHref } from '@/lib/setup-nav';

interface WizardStepProps {
  slug: (typeof SETUP_STEPS)[number]['slug'];
  description?: string;
  children: React.ReactNode;
  nextLabel?: string;
  /**
   * If the page has its own submit button (a form), hide the shell's Continue.
   * Back link stays available in top-left.
   */
  ownContinue?: boolean;
}

export function WizardStep({
  slug,
  description,
  children,
  nextLabel = 'Continue',
  ownContinue = false,
}: WizardStepProps) {
  const idx = SETUP_STEPS.findIndex((s) => s.slug === slug);
  const step = SETUP_STEPS[idx]!;
  const prev = prevHref(slug);
  const prevStep = idx > 0 ? SETUP_STEPS[idx - 1] : null;
  const next = nextHref(slug) ?? '/dashboard';
  const isLast = idx === SETUP_STEPS.length - 1;

  return (
    <StepShell
      title={step.title}
      {...(description ? { description } : {})}
      {...(prev ? { backHref: prev, backLabel: `Back to ${prevStep!.title}` } : {})}
      {...(ownContinue ? {} : { nextHref: next, nextLabel: isLast ? 'Enter dashboard' : nextLabel })}
    >
      {children}
    </StepShell>
  );
}
