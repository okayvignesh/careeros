'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '../utils';
import { Tip } from './Tooltip';

type Tone = 'default' | 'accent' | 'success' | 'warn' | 'danger';

interface StatProps {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  progress?: number;
  tone?: Tone;
  helpTip?: string;
  className?: string;
}

const toneRing: Record<Tone, string> = {
  default: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle',
  accent: 'border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.10)] text-[hsl(var(--accent))]',
  success: 'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
  warn: 'border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.10)] text-[hsl(var(--warn))]',
  danger: 'border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.10)] text-[hsl(var(--danger))]',
};

const toneBar: Record<Tone, string> = {
  default: 'bg-[hsl(var(--accent))]',
  accent: 'bg-[hsl(var(--accent))]',
  success: 'bg-[hsl(var(--success))]',
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
};

/**
 * One canonical stat card. Notion-panel look, 32px tabular figure, optional
 * progress bar and tone. Replaces the ad-hoc KpiCard and Stat implementations.
 */
export function Stat({
  icon: Icon,
  label,
  value,
  detail,
  progress,
  tone = 'default',
  helpTip,
  className,
}: StatProps) {
  const labelNode = helpTip ? (
    <Tip label={helpTip}>
      <span className="cursor-default text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </span>
    </Tip>
  ) : (
    <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-faint">
      {label}
    </span>
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-4',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className={cn('grid h-7 w-7 place-items-center rounded-md border', toneRing[tone])}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
          </div>
        )}
        {labelNode}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[32px] font-semibold leading-none tabular-nums text-fg">{value}</span>
        {detail && <span className="text-[11.5px] tabular-nums text-fg-subtle">{detail}</span>}
        {typeof progress === 'number' && (
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
            <div
              className={cn('h-full transition-[width] duration-500', toneBar[tone])}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
