/**
 * Shown when a panel's endpoint is missing or failing. Panels must render this
 * rather than a fixture — a backend gap should read as a gap, never as a
 * plausible-looking screen with fabricated numbers (A8).
 *
 * Uses React.createElement instead of JSX because tsconfig ships
 * `jsx: preserve` for Next, while the vitest render test cannot import a
 * preserve-mode .tsx. Same approach as packages/ui CodeEditor.
 */
import { createElement, type ReactElement } from 'react';

export interface UnavailableNoticeProps {
  /** What could not be loaded, e.g. "Skill demand". */
  feature: string;
  /** Override the default test id when a screen needs to target it. */
  testId?: string;
}

export function UnavailableNotice({
  feature,
  testId = 'unavailable-notice',
}: UnavailableNoticeProps): ReactElement {
  return createElement(
    'div',
    {
      role: 'status',
      'aria-live': 'polite',
      'data-testid': testId,
      className:
        'rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center',
    },
    createElement(
      'p',
      { className: 'text-[13.5px] text-fg-muted' },
      `${feature} isn’t available yet. Nothing is shown here rather than simulated data.`,
    ),
  );
}
