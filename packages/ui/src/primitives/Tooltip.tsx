'use client';

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../utils';

/**
 * Shadcn-style tooltip built on Radix. Compose like:
 *   <Tooltip>
 *     <TooltipTrigger asChild><button /></TooltipTrigger>
 *     <TooltipContent>text</TooltipContent>
 *   </Tooltip>
 *
 * A single <TooltipProvider> lives at the app root so delay/timing is shared.
 * The convenience <Tip label={...}>{child}</Tip> below covers the common case.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Popover surface: match the app's elevated panel + hairline border, no gradients.
        'z-50 max-w-[min(280px,80vw)] overflow-hidden rounded-md',
        'border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-2))]',
        'px-2.5 py-1.5 text-[12px] leading-snug text-fg shadow-[0_8px_24px_-12px_hsl(0_0%_0%/0.6)]',
        // Enter/exit animation.
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1',
        'data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Convenience wrapper for the common "just show this string on hover" case.
 * Wrap any interactive child (button, link, etc.) — asChild is applied automatically.
 * If `label` is empty, renders children raw so callers can pass `label={cond ? '...' : ''}`.
 */
export function Tip({
  label,
  children,
  side = 'top',
  align = 'center',
  delayDuration,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
}) {
  if (label === null || label === undefined || label === '') return <>{children}</>;
  return (
    <Tooltip {...(delayDuration !== undefined ? { delayDuration } : {})}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
