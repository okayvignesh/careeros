'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none ' +
  'transition-[background-color,border-color,color,box-shadow,filter] duration-200 ease-[var(--ease)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] ' +
  'disabled:pointer-events-none disabled:opacity-40 rounded-[var(--radius)]';

const variants: Record<Variant, string> = {
  primary:
    'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-[0_1px_0_hsl(0_0%_100%/0.14)_inset,0_1px_2px_hsl(0_0%_0%/0.4),0_6px_20px_-8px_hsl(var(--accent)/0.5)] hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[hsl(var(--bg-elev-1))] text-[hsl(var(--fg))] border border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--bg-elev-2))] hover:border-[hsl(var(--border-active))] active:brightness-95',
  ghost:
    'bg-transparent text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] hover:bg-[hsl(var(--bg-hover))] active:brightness-95',
  danger:
    'bg-[hsl(var(--danger))] text-white hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_hsl(0_0%_0%/0.4)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[13.5px]',
  lg: 'h-11 px-5 text-[14px]',
};

const motionTransition = { type: 'spring' as const, stiffness: 420, damping: 22, mass: 0.5 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={motionTransition}
      className={cn(base, variants[variant], sizes[size], className)}
      {...(props as unknown as HTMLMotionProps<'button'>)}
    >
      {children}
    </motion.button>
  ),
);
Button.displayName = 'Button';
