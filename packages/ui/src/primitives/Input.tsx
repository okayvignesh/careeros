import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-11 w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-3.5 py-2 text-sm text-fg',
        'placeholder:text-[hsl(var(--fg-subtle))]',
        'transition-[border-color,background-color,box-shadow] duration-[var(--dur)] ease-[var(--ease)]',
        'focus-visible:outline-none focus-visible:border-[hsl(var(--accent)/0.7)] focus-visible:bg-[hsl(var(--bg-elev))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent)/0.25)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
