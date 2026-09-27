import type { HTMLAttributes } from 'react';
import { cn } from '../utils';

/**
 * Small sentence-case label for section eyebrows, metadata rows.
 * Inter medium, tabular figures, subtle tracking. No mono, no uppercase.
 */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'text-[12px] font-medium tracking-[0.01em] text-fg-subtle tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
