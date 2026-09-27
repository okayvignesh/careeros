import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../utils';

interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
}

const pads = {
  sm: 'p-5',
  md: 'p-7',
  lg: 'p-9',
} as const;

export const Glass = forwardRef<HTMLDivElement, GlassProps>(
  ({ className, padding = 'md', ...props }, ref) => (
    <div ref={ref} className={cn('glass', pads[padding], className)} {...props} />
  ),
);
Glass.displayName = 'Glass';
